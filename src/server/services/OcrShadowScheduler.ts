import 'server-only';

import { after } from 'next/server';

import { OcrMode } from '@/domain/enums/OcrMode';
import { OcrShadowStatus } from '@/domain/enums/OcrShadowStatus';
import { getAppConfig } from '@/server/config/AppConfig';
import { type Db } from '@/server/db/Database';
import { type OcrShadowInput, runOcrShadow } from '@/server/services/OcrShadowRunner';
import { type ServiceOcr } from '@/server/vision/ocr/OcrServiceEngine';

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
};

/** Loaded only when a run starts, so routes do not load tesseract.js while OCR is off. */
const acquireDefaultOcr = async (): Promise<ServiceOcr> =>
  (await import('@/server/vision/ocr/OcrServiceEngine')).acquireServiceOcr();

const buildDefaultOptions = (): OcrShadowScheduleOptions => ({
  config: getAppConfig(),
  random: Math.random,
  schedule: after,
  acquireOcr: acquireDefaultOcr,
});

type ShadowGlobal = typeof globalThis & { __offnalOcrShadowOverrides?: Partial<OcrShadowScheduleOptions> };

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

const describeError = (error: unknown): string => (error instanceof Error ? error.name : typeof error);

/**
 * Queues a shadow OCR run after the response (Spec §21-2). Returns whether a run was queued. Never throws
 * and never changes the response: the run itself records failures as rows.
 */
export const scheduleOcrShadow = (
  db: Db,
  input: OcrShadowInput,
  options: Partial<OcrShadowScheduleOptions> = {},
): boolean => {
  const resolved = { ...buildDefaultOptions(), ...shadowGlobal.__offnalOcrShadowOverrides, ...options };

  if (!shouldRunOcrShadow(resolved.config, resolved.random)) {
    return false;
  }

  const timeoutMs = resolved.config.ocrTimeoutMs ?? getAppConfig().ocrTimeoutMs;

  const task = async (): Promise<void> => {
    try {
      const engine = await resolved.acquireOcr();
      const status = await runOcrShadow(
        { db, ocr: engine.provider, timeoutMs, coldStart: engine.coldStart },
        input,
      );

      if (status === OcrShadowStatus.TIMEOUT) {
        await engine.discard();
      }
    } catch (error: unknown) {
      // Engine start-up failed before a run could record anything.
      console.warn('[ocr-shadow] run failed', { name: describeError(error) });
    }
  };

  try {
    resolved.schedule(task);
  } catch (error: unknown) {
    console.warn('[ocr-shadow] schedule failed', { name: describeError(error) });

    return false;
  }

  return true;
};
