import { RecognitionErrorCode } from '@/domain/enums/RecognitionErrorCode';
import { VisionPipelineFallback } from '@/domain/enums/VisionPipelineFallback';
import { VisionPipelineMode } from '@/domain/enums/VisionPipelineMode';
import { VisionPipelineRoute } from '@/domain/enums/VisionPipelineRoute';
import { VisionPipelineStep } from '@/domain/enums/VisionPipelineStep';
import { type GridCorners } from '@/domain/types/GridCorners';
import { type PersonExtraction } from '@/domain/types/PersonExtraction';
import { type WarpResult, warpToGrid } from '@/server/vision/PerspectiveWarp';
import { buildRowStrip, computeStripPlan } from '@/server/vision/RowStrip';
import {
  type PersonExtractionInput,
  type RowBand,
  type VisionImage,
  type VisionProvider,
  VisionProviderError,
  type VisionUsage,
} from '@/server/vision/VisionProvider';

/**
 * Runs one provider call of the pipeline. The service passes the call through with its request signal;
 * the eval wraps it with retries and records. Throws when the call failed.
 */
export type PipelineCallRunner = <T extends { usage?: VisionUsage }>(
  step: VisionPipelineStep,
  run: (signal: AbortSignal) => Promise<T>,
) => Promise<T>;

/** Second-pass input prepared once per image (shared by every person of that image). */
export type PreparedPipelineImage = {
  mode: VisionPipelineMode;
  original: VisionImage;
  /** Perspective-corrected table, null for baseline or when the corners were unusable. */
  warp: WarpResult | null;
  fallback: VisionPipelineFallback | null;
};

export type PipelineExtraction = {
  extraction: PersonExtraction;
  route: VisionPipelineRoute;
  fallback: VisionPipelineFallback | null;
  /** Row located by pass 2a (strip route only). */
  band: RowBand | null;
  /** Strip sent to the model (memory only; the eval saves it as a debug image). */
  strip: VisionImage | null;
};

const describeError = (error: unknown): string => (error instanceof Error ? error.name : typeof error);

/**
 * Warps the provider copy with the pass-1 grid for the warp modes. Missing or unusable corners (and any
 * warp error) fall back to the original image: never a recognition failure.
 */
export const preparePipelineImage = async (
  mode: VisionPipelineMode,
  original: VisionImage,
  grid: GridCorners | null | undefined,
): Promise<PreparedPipelineImage> => {
  if (mode === VisionPipelineMode.BASELINE) {
    return { mode, original, warp: null, fallback: null };
  }

  if (!grid) {
    return { mode, original, warp: null, fallback: VisionPipelineFallback.NO_GRID };
  }

  try {
    const warp = await warpToGrid(original, grid);

    return { mode, original, warp, fallback: warp ? null : VisionPipelineFallback.INVALID_GRID };
  } catch (error: unknown) {
    console.warn('[vision] perspective warp failed', { name: describeError(error) });

    return { mode, original, warp: null, fallback: VisionPipelineFallback.INVALID_GRID };
  }
};

/** Timeouts and missing keys end the request; any other locate failure only loses the strip. */
const isFatalLocateError = (error: unknown): boolean =>
  error instanceof VisionProviderError &&
  (error.errorCode === RecognitionErrorCode.PROVIDER_TIMEOUT ||
    error.errorCode === RecognitionErrorCode.PROVIDER_NOT_CONFIGURED);

/**
 * The legend is outside the corrected table, so pass 1's legend (read from the whole photo) is kept
 * instead of whatever the model returns without seeing it.
 */
const withPassOneLegend = (extraction: PersonExtraction, input: PersonExtractionInput): PersonExtraction => ({
  ...extraction,
  definitions: input.definitions.map((definition) => ({ ...definition })),
});

const stripUsage = <T extends { usage?: VisionUsage }>(result: T): Omit<T, 'usage'> => {
  const { usage: _usage, ...rest } = result;

  return rest;
};

type StripAttempt =
  { ok: true; strip: VisionImage; band: RowBand } | { ok: false; fallback: VisionPipelineFallback };

const buildStripForRow = async (
  provider: VisionProvider,
  warp: WarpResult,
  input: PersonExtractionInput,
  runCall: PipelineCallRunner,
): Promise<StripAttempt> => {
  let band: RowBand | null;

  try {
    ({ band } = await runCall(VisionPipelineStep.LOCATE_ROW, (signal) =>
      provider.locateRow(warp.image, { rowId: input.rowId, name: input.name }, signal),
    ));
  } catch (error: unknown) {
    if (isFatalLocateError(error)) {
      throw error;
    }

    return { ok: false, fallback: VisionPipelineFallback.LOCATE_FAILED };
  }

  if (!band) {
    return { ok: false, fallback: VisionPipelineFallback.ROW_NOT_FOUND };
  }

  const plan = computeStripPlan(
    { width: warp.raw.width, height: warp.raw.height, dayGrid: warp.dayGrid },
    band,
  );

  if (!plan) {
    return { ok: false, fallback: VisionPipelineFallback.INVALID_ROW };
  }

  try {
    return { ok: true, strip: await buildRowStrip(warp.raw, plan), band };
  } catch (error: unknown) {
    console.warn('[vision] strip build failed', { name: describeError(error) });

    return { ok: false, fallback: VisionPipelineFallback.LOCATE_FAILED };
  }
};

/**
 * Second pass for one person (Spec §15): original image (baseline / no usable grid), warped table
 * (warp, or warp-strip when the row cannot be located) or header+row strip with the warped table as
 * reference. Provider errors of the final extract call propagate to the caller.
 */
export const extractPersonWithPipeline = async (
  provider: VisionProvider,
  prepared: PreparedPipelineImage,
  input: PersonExtractionInput,
  runCall: PipelineCallRunner,
): Promise<PipelineExtraction> => {
  const { warp } = prepared;

  if (!warp) {
    const result = await runCall(VisionPipelineStep.EXTRACT, (signal) =>
      provider.extractPerson(prepared.original, input, signal),
    );

    return {
      extraction: stripUsage(result),
      route: VisionPipelineRoute.ORIGINAL,
      fallback: prepared.fallback,
      band: null,
      strip: null,
    };
  }

  const extractWarped = async (fallback: VisionPipelineFallback | null): Promise<PipelineExtraction> => {
    const result = await runCall(VisionPipelineStep.EXTRACT, (signal) =>
      provider.extractPerson(warp.image, input, signal),
    );

    return {
      extraction: withPassOneLegend(stripUsage(result), input),
      route: VisionPipelineRoute.WARPED,
      fallback,
      band: null,
      strip: null,
    };
  };

  if (prepared.mode !== VisionPipelineMode.WARP_STRIP) {
    return extractWarped(null);
  }

  const attempt = await buildStripForRow(provider, warp, input, runCall);

  if (!attempt.ok) {
    return extractWarped(attempt.fallback);
  }

  const result = await runCall(VisionPipelineStep.EXTRACT_STRIP, (signal) =>
    provider.extractPersonFromStrip(attempt.strip, warp.image, input, signal),
  );

  return {
    extraction: stripUsage(result),
    route: VisionPipelineRoute.STRIP,
    fallback: null,
    band: attempt.band,
    strip: attempt.strip,
  };
};
