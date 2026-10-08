import 'server-only';

import { after } from 'next/server';

import { OcrMode } from '@/domain/enums/OcrMode';
import { OcrShadowErrorKind } from '@/domain/enums/OcrShadowErrorKind';
import { OcrShadowStatus } from '@/domain/enums/OcrShadowStatus';
import { getAppConfig } from '@/server/config/AppConfig';
import { type Db } from '@/server/db/Database';
import { EXTRACT_MAX_DURATION_SECONDS } from '@/server/services/ExtractRouteLimits';
import {
  describeError,
  type OcrShadowInput,
  recordOcrShadowSkip,
  runOcrShadow,
} from '@/server/services/OcrShadowRunner';
import { type ServiceOcr } from '@/server/vision/ocr/OcrServiceEngine';

const MS_PER_SECOND = 1000;

/** Kept free at the end of the invocation (insert, engine discard, platform overhead). */
export const OCR_BUDGET_SAFETY_MS = 10_000;
/** Below this, a run could not finish even a small table: it is recorded as skipped instead. */
export const MIN_OCR_BUDGET_MS = 15_000;

/** Shadow runs in flight per instance (the engine is shared; a second run would only queue behind). */
const MAX_IN_FLIGHT = 1;

type ShadowGateConfig = {
  ocrMode: OcrMode;
  ocrShadowSampleRate: number;
  /** Defaults to the app config's OCR_TIMEOUT_MS. */
  ocrTimeoutMs?: number;
};

export type OcrShadowScheduleOptions = {
  config: ShadowGateConfig;
  random: () => number;
  /** Runs the task after the response (`after` from next/server). */
  schedule: (task: () => Promise<void>) => void;
  acquireOcr: () => Promise<ServiceOcr>;
  /** Wall clock in epoch ms (default `Date.now`), compared with `requestStartedAt`. */
  now: () => number;
};

/** Loaded only when a run starts, so routes do not load tesseract.js while OCR is off. */
const acquireDefaultOcr = async (): Promise<ServiceOcr> =>
  (await import('@/server/vision/ocr/OcrServiceEngine')).acquireServiceOcr();

const buildDefaultOptions = (): OcrShadowScheduleOptions => ({
  config: getAppConfig(),
  random: Math.random,
  schedule: after,
  acquireOcr: acquireDefaultOcr,
  now: Date.now,
});

type ShadowGlobal = typeof globalThis & {
  __offnalOcrShadowOverrides?: Partial<OcrShadowScheduleOptions>;
  /** Runs started and not finished on this instance (shared across module copies in dev). */
  __offnalOcrShadowInFlight?: number;
};

const shadowGlobal = globalThis as ShadowGlobal;

/** Replaces scheduling dependencies (null restores the defaults). Tests only. */
export const setOcrShadowOverridesForTesting = (
  overrides: Partial<OcrShadowScheduleOptions> | null,
): void => {
  shadowGlobal.__offnalOcrShadowOverrides = overrides ?? undefined;
};

/** Shadow mode on and this extract sampled (rate 1 = every extract, 0 = none). */
export const shouldRunOcrShadow = (config: ShadowGateConfig, random: () => number): boolean =>
  config.ocrMode === OcrMode.SHADOW && random() < config.ocrShadowSampleRate;

/**
 * Timeout for a run starting at `now`: OCR_TIMEOUT_MS, capped by what is left of the route's maxDuration
 * (measured from the request start) minus a safety margin. Null when less than the minimum is left.
 */
export const resolveOcrShadowTimeout = (
  configTimeoutMs: number,
  requestStartedAt: number,
  now: number,
): number | null => {
  const elapsedMs = Math.max(0, now - requestStartedAt);
  const remainingMs = EXTRACT_MAX_DURATION_SECONDS * MS_PER_SECOND - elapsedMs - OCR_BUDGET_SAFETY_MS;
  const timeoutMs = Math.min(configTimeoutMs, remainingMs);

  if (timeoutMs < MIN_OCR_BUDGET_MS) {
    return null;
  }

  return timeoutMs;
};

const runScheduled = async (
  db: Db,
  input: OcrShadowInput,
  resolved: OcrShadowScheduleOptions,
  requestStartedAt: number,
): Promise<void> => {
  const timeoutMs = resolveOcrShadowTimeout(
    resolved.config.ocrTimeoutMs ?? getAppConfig().ocrTimeoutMs,
    requestStartedAt,
    resolved.now(),
  );

  if (timeoutMs === null) {
    await recordOcrShadowSkip(db, input.jobId, OcrShadowStatus.SKIPPED_BUDGET);

    return;
  }

  const inFlight = shadowGlobal.__offnalOcrShadowInFlight ?? 0;

  if (inFlight >= MAX_IN_FLIGHT) {
    await recordOcrShadowSkip(db, input.jobId, OcrShadowStatus.SKIPPED_BUSY);

    return;
  }

  // Taken synchronously after the check, so two tasks starting together cannot both pass it.
  shadowGlobal.__offnalOcrShadowInFlight = inFlight + 1;

  try {
    let engine: Awaited<ReturnType<typeof resolved.acquireOcr>>;

    try {
      engine = await resolved.acquireOcr();
    } catch (error: unknown) {
      // Engine module import or initialization failed; record as an error run.
      await recordOcrShadowSkip(db, input.jobId, OcrShadowStatus.ERROR, undefined, OcrShadowErrorKind.UNKNOWN);
      console.warn('[ocr-shadow] acquire failed', { name: describeError(error) });

      return;
    }

    const status = await runOcrShadow(
      { db, ocr: engine.provider, timeoutMs, coldStart: engine.coldStart },
      input,
    );

    // A timed-out engine may still hold queued jobs, a failed one may be broken: start fresh next time.
    if (status === OcrShadowStatus.TIMEOUT || status === OcrShadowStatus.ERROR) {
      await engine.discard();
    }
  } finally {
    shadowGlobal.__offnalOcrShadowInFlight = Math.max(0, (shadowGlobal.__offnalOcrShadowInFlight ?? 1) - 1);
  }
};

/**
 * Queues a shadow OCR run after the response (Spec §22-2). Returns whether a run was queued. Never throws
 * and never changes the response: the run itself records failures and skips as rows. `requestStartedAt`
 * (epoch ms) is when the extract request started, for the shared maxDuration budget.
 */
export const scheduleOcrShadow = (
  db: Db,
  input: OcrShadowInput,
  requestStartedAt: number,
  options: Partial<OcrShadowScheduleOptions> = {},
): boolean => {
  try {
    const resolved = { ...buildDefaultOptions(), ...shadowGlobal.__offnalOcrShadowOverrides, ...options };

    if (!shouldRunOcrShadow(resolved.config, resolved.random)) {
      return false;
    }

    resolved.schedule(async () => {
      try {
        await runScheduled(db, input, resolved, requestStartedAt);
      } catch (error: unknown) {
        // Engine start-up or discard failed outside a run's own error handling.
        console.warn('[ocr-shadow] run failed', { name: describeError(error) });
      }
    });

    return true;
  } catch (error: unknown) {
    console.warn('[ocr-shadow] schedule failed', { name: describeError(error) });

    return false;
  }
};
