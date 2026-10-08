import 'server-only';

import { OcrShadowErrorKind } from '@/domain/enums/OcrShadowErrorKind';
import { OcrShadowStatus } from '@/domain/enums/OcrShadowStatus';
import { getAppConfig } from '@/server/config/AppConfig';
import { type DbExecutor } from '@/server/db/Database';
import { describeError } from '@/server/errors/ErrorName';
import { OCR_SHADOW_MAX_DURATION_SECONDS } from '@/server/services/OcrShadowRouteLimits';
import {
  type OcrShadowDeps,
  type OcrShadowInput,
  probeOcrTable,
  readProcessRssMb,
  recordOcrShadowSkip,
  runOcrShadow,
} from '@/server/services/OcrShadowRunner';
import { type ServiceOcr } from '@/server/vision/ocr/OcrServiceEngine';

const MS_PER_SECOND = 1000;
/** RSS sampling interval of a probe (approximates the peak; worker threads share the process RSS). */
const PROBE_RSS_SAMPLE_MS = 200;

/** Kept free at the end of the invocation (insert, engine discard, platform overhead). */
export const OCR_BUDGET_SAFETY_MS = 10_000;
/** Below this, a run could not finish even a small table: it is recorded as skipped instead. */
export const MIN_OCR_BUDGET_MS = 15_000;

/** Shadow runs (and probes) in flight per instance: the engine is shared, a second run would only queue. */
const MAX_IN_FLIGHT = 1;

export type OcrShadowExecutorOptions = {
  /** OCR_TIMEOUT_MS (default from the app config). */
  ocrTimeoutMs: number;
  acquireOcr: () => Promise<ServiceOcr>;
  /** Wall clock in epoch ms (default `Date.now`), compared with the route's start. */
  now: () => number;
  /** Table reader passed to the runner (tests only; default the real reader). */
  readTable?: OcrShadowDeps['readTable'];
  readRssMb: () => number;
};

/** Loaded only when a run starts, so nothing loads tesseract.js before the first run of an instance. */
const acquireDefaultOcr = async (): Promise<ServiceOcr> =>
  (await import('@/server/vision/ocr/OcrServiceEngine')).acquireServiceOcr();

const buildDefaultOptions = (): OcrShadowExecutorOptions => ({
  ocrTimeoutMs: getAppConfig().ocrTimeoutMs,
  acquireOcr: acquireDefaultOcr,
  now: Date.now,
  readRssMb: readProcessRssMb,
});

type ExecutorGlobal = typeof globalThis & {
  __offnalOcrShadowExecutorOverrides?: Partial<OcrShadowExecutorOptions>;
  /** Runs started and not finished on this instance (shared across module copies in dev). */
  __offnalOcrShadowInFlight?: number;
};

const executorGlobal = globalThis as ExecutorGlobal;

/** Replaces execution dependencies (null restores the defaults). Tests only. */
export const setOcrShadowExecutorOverridesForTesting = (
  overrides: Partial<OcrShadowExecutorOptions> | null,
): void => {
  executorGlobal.__offnalOcrShadowExecutorOverrides = overrides ?? undefined;
};

const resolveOptions = (options: Partial<OcrShadowExecutorOptions>): OcrShadowExecutorOptions => ({
  ...buildDefaultOptions(),
  ...executorGlobal.__offnalOcrShadowExecutorOverrides,
  ...options,
});

/**
 * Timeout for a run starting at `now`: OCR_TIMEOUT_MS, capped by what is left of the internal route's
 * maxDuration (measured from the route's start) minus a safety margin. Null when less than the minimum
 * is left.
 */
export const resolveOcrShadowTimeout = (
  configTimeoutMs: number,
  routeStartedAt: number,
  now: number,
): number | null => {
  const elapsedMs = Math.max(0, now - routeStartedAt);
  const remainingMs = OCR_SHADOW_MAX_DURATION_SECONDS * MS_PER_SECOND - elapsedMs - OCR_BUDGET_SAFETY_MS;
  const timeoutMs = Math.min(configTimeoutMs, remainingMs);

  if (timeoutMs < MIN_OCR_BUDGET_MS) {
    return null;
  }

  return timeoutMs;
};

type SlotOutcome<T> = { ran: true; value: T } | { ran: false; status: OcrShadowStatus };

/**
 * Runs `task` holding this instance's single shadow slot with the budgeted timeout, or reports why it
 * did not start (`skipped_budget`, `skipped_busy`).
 */
const withShadowSlot = async <T>(
  resolved: OcrShadowExecutorOptions,
  routeStartedAt: number,
  task: (timeoutMs: number) => Promise<T>,
): Promise<SlotOutcome<T>> => {
  const timeoutMs = resolveOcrShadowTimeout(resolved.ocrTimeoutMs, routeStartedAt, resolved.now());

  if (timeoutMs === null) {
    return { ran: false, status: OcrShadowStatus.SKIPPED_BUDGET };
  }

  const inFlight = executorGlobal.__offnalOcrShadowInFlight ?? 0;

  if (inFlight >= MAX_IN_FLIGHT) {
    return { ran: false, status: OcrShadowStatus.SKIPPED_BUSY };
  }

  // Taken synchronously after the check, so two requests starting together cannot both pass it.
  executorGlobal.__offnalOcrShadowInFlight = inFlight + 1;

  try {
    return { ran: true, value: await task(timeoutMs) };
  } finally {
    executorGlobal.__offnalOcrShadowInFlight = Math.max(
      0,
      (executorGlobal.__offnalOcrShadowInFlight ?? 1) - 1,
    );
  }
};

/** The instance engine, or null when its module or start-up failed (logged by error class name only). */
const tryAcquireOcr = async (resolved: OcrShadowExecutorOptions): Promise<ServiceOcr | null> => {
  try {
    return await resolved.acquireOcr();
  } catch (error: unknown) {
    console.warn('[ocr-shadow] acquire failed', { name: describeError(error) });

    return null;
  }
};

/** A timed-out engine may still hold queued jobs, a failed one may be broken: start fresh next time. */
const discardAfterFailure = async (engine: ServiceOcr, status: OcrShadowStatus): Promise<void> => {
  if (status !== OcrShadowStatus.TIMEOUT && status !== OcrShadowStatus.ERROR) {
    return;
  }

  try {
    await engine.discard();
  } catch (error: unknown) {
    console.warn('[ocr-shadow] discard failed', { name: describeError(error) });
  }
};

/**
 * One shadow run in the internal route (Spec §22-11): budget and concurrency checks, engine, comparison
 * row. Every outcome is a row in `ocr_shadow_runs` (skips and engine load failures included). Never
 * throws; returns the recorded status.
 */
export const executeOcrShadow = async (
  db: DbExecutor,
  input: OcrShadowInput,
  routeStartedAt: number,
  options: Partial<OcrShadowExecutorOptions> = {},
): Promise<OcrShadowStatus> => {
  try {
    const resolved = resolveOptions(options);
    const outcome = await withShadowSlot(resolved, routeStartedAt, async (timeoutMs) => {
      const engine = await tryAcquireOcr(resolved);

      if (!engine) {
        await recordOcrShadowSkip(
          db,
          input.jobId,
          OcrShadowStatus.ERROR,
          resolved.readRssMb,
          OcrShadowErrorKind.UNKNOWN,
        );

        return OcrShadowStatus.ERROR;
      }

      const status = await runOcrShadow(
        {
          db,
          ocr: engine.provider,
          timeoutMs,
          coldStart: engine.coldStart,
          readTable: resolved.readTable,
          readRssMb: resolved.readRssMb,
        },
        input,
      );

      await discardAfterFailure(engine, status);

      return status;
    });

    if (outcome.ran) {
      return outcome.value;
    }

    await recordOcrShadowSkip(db, input.jobId, outcome.status, resolved.readRssMb);

    return outcome.status;
  } catch (error: unknown) {
    console.warn('[ocr-shadow] run failed', { name: describeError(error) });

    return OcrShadowStatus.ERROR;
  }
};

/** Probe response (Spec §22-11): numbers and enum values only — no text, name or code. */
export type OcrShadowProbeResult = {
  status: OcrShadowStatus;
  errorName: OcrShadowErrorKind | null;
  /** From the probe's start (waiting for the slot and starting the engine included). */
  ms: number;
  coldStart: boolean;
  rssBeforeMb: number;
  rssAfterMb: number;
  /** Highest RSS sampled during the run (an approximation of the peak). */
  rssPeakMb: number;
  tableFound: boolean;
  rowCount: number;
};

/** Runs `task` while sampling RSS; returns the task's value and the highest sample. */
const withRssPeak = async <T>(
  readRssMb: () => number,
  task: () => Promise<T>,
): Promise<{ value: T; peakMb: number }> => {
  let peakMb = readRssMb();
  const sampler = setInterval(() => {
    peakMb = Math.max(peakMb, readRssMb());
  }, PROBE_RSS_SAMPLE_MS);

  sampler.unref();

  try {
    const value = await task();

    peakMb = Math.max(peakMb, readRssMb());

    return { value, peakMb };
  } finally {
    clearInterval(sampler);
  }
};

/**
 * The probe request: table reading only on a posted photo with the same engine, slot and budget as a
 * shadow run, nothing stored. Never throws.
 */
export const probeOcrShadow = async (
  sourceBytes: Buffer,
  routeStartedAt: number,
  options: Partial<OcrShadowExecutorOptions> = {},
): Promise<OcrShadowProbeResult> => {
  const resolved = resolveOptions(options);
  const startedAt = resolved.now();
  const rssBeforeMb = resolved.readRssMb();
  let coldStart = false;

  const probe = async (timeoutMs: number) => {
    const engine = await tryAcquireOcr(resolved);

    if (!engine) {
      return {
        status: OcrShadowStatus.ERROR,
        errorName: OcrShadowErrorKind.UNKNOWN,
        tableFound: false,
        rowCount: 0,
      };
    }

    coldStart = engine.coldStart;

    const result = await probeOcrTable(
      { ocr: engine.provider, timeoutMs, readTable: resolved.readTable },
      sourceBytes,
    );

    await discardAfterFailure(engine, result.status);

    return result;
  };

  try {
    const { value: outcome, peakMb } = await withRssPeak(resolved.readRssMb, () =>
      withShadowSlot(resolved, routeStartedAt, probe),
    );
    const table = outcome.ran
      ? outcome.value
      : { status: outcome.status, errorName: null, tableFound: false, rowCount: 0 };

    return {
      ...table,
      ms: Math.max(0, Math.round(resolved.now() - startedAt)),
      coldStart,
      rssBeforeMb,
      rssAfterMb: resolved.readRssMb(),
      rssPeakMb: peakMb,
    };
  } catch (error: unknown) {
    console.warn('[ocr-shadow] probe failed', { name: describeError(error) });

    return {
      status: OcrShadowStatus.ERROR,
      errorName: OcrShadowErrorKind.UNKNOWN,
      ms: Math.max(0, Math.round(resolved.now() - startedAt)),
      coldStart,
      rssBeforeMb,
      rssAfterMb: resolved.readRssMb(),
      rssPeakMb: rssBeforeMb,
      tableFound: false,
      rowCount: 0,
    };
  }
};
