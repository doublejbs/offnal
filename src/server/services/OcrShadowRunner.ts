import 'server-only';

import sharp from 'sharp';

import { OcrShadowStatus } from '@/domain/enums/OcrShadowStatus';
import { type NormalizedSchedule } from '@/domain/types/NormalizedSchedule';
import { type DbExecutor } from '@/server/db/Database';
import { ocrShadowRuns } from '@/server/db/Schema';
import { measureOcrTable, type ShadowMeasurement } from '@/server/vision/ocr/OcrShadowComparison';
import { type OcrProvider } from '@/server/vision/ocr/OcrProvider';
import { readOcrTable } from '@/server/vision/ocr/OcrTableReader';
import { type OcrTableResult } from '@/server/vision/ocr/OcrTableTypes';
import { decodeRaw } from '@/server/vision/RawImageCodec';
import { type RawImage } from '@/server/vision/VisionGeometry';

const BYTES_PER_MB = 1024 * 1024;
/** Error class names are short identifiers; anything longer is cut (never a message). */
const MAX_ERROR_NAME_LENGTH = 64;

export type OcrShadowInput = {
  jobId: string;
  /** Original upload bytes (full resolution, as the eval reads them). */
  sourceBytes: Buffer;
  /** Name the user chose (pass-1 candidate). */
  name: string;
  /** Month the user confirmed. */
  yearMonth: string;
  /** The AI result that was stored (the comparison reference). */
  aiSchedule: NormalizedSchedule;
};

export type OcrShadowDeps = {
  db: DbExecutor;
  ocr: OcrProvider;
  timeoutMs: number;
  coldStart: boolean;
  /** Milliseconds clock (default `performance.now`). */
  now?: () => number;
  /** Table reader (default `readOcrTable`); tests swap it to control the table. */
  readTable?: (source: RawImage, ocr: OcrProvider) => Promise<OcrTableResult>;
  readRssMb?: () => number;
};

class OcrShadowTimeoutError extends Error {
  constructor() {
    super('OCR shadow run timed out');
    this.name = 'OcrShadowTimeoutError';
  }
}

const readProcessRssMb = (): number => Math.round(process.memoryUsage().rss / BYTES_PER_MB);

const describeError = (error: unknown): string =>
  (error instanceof Error ? error.name : typeof error).slice(0, MAX_ERROR_NAME_LENGTH);

/** Rejects after `timeoutMs`; the engine keeps running in the background (it has no abort hook). */
const withTimeout = async <T>(work: Promise<T>, timeoutMs: number): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new OcrShadowTimeoutError()), timeoutMs);
    timer.unref();
  });

  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
};

/** EXIF orientation applied like the eval and the provider copy, then raw RGB for the OCR reader. */
const decodeSource = async (bytes: Buffer): Promise<RawImage> =>
  decodeRaw(await sharp(bytes).rotate().toBuffer());

const FAILED = { counts: null, unresolvedCells: null, reviewCells: null, wouldFallback: true };

/**
 * One shadow OCR run (Spec §21): reads the photo without AI, compares the chosen person with the AI result
 * and stores numbers only. Never throws — every failure becomes a row (or, if even the insert fails, a
 * warning with the error class name).
 */
export const runOcrShadow = async (deps: OcrShadowDeps, input: OcrShadowInput): Promise<OcrShadowStatus> => {
  const now = deps.now ?? (() => performance.now());
  const readTable = deps.readTable ?? readOcrTable;
  const startedAt = now();
  let measurement: ShadowMeasurement;
  let errorName: string | null = null;

  try {
    const work = (async () => {
      const source = await decodeSource(input.sourceBytes);
      const result = await readTable(source, deps.ocr);

      return measureOcrTable(result, input.name, input.yearMonth, input.aiSchedule);
    })();

    measurement = await withTimeout(work, deps.timeoutMs);
  } catch (error: unknown) {
    const timedOut = error instanceof OcrShadowTimeoutError;

    measurement = { status: timedOut ? OcrShadowStatus.TIMEOUT : OcrShadowStatus.ERROR, ...FAILED };
    errorName = timedOut ? null : describeError(error);
  }

  const ocrMs = Math.max(0, Math.round(now() - startedAt));

  try {
    await deps.db.insert(ocrShadowRuns).values({
      jobId: input.jobId,
      status: measurement.status,
      errorName,
      dayCount: measurement.counts?.dayCount ?? null,
      agreeCells: measurement.counts?.agreeCells ?? null,
      disagreeCells: measurement.counts?.disagreeCells ?? null,
      ocrNullCells: measurement.counts?.ocrNullCells ?? null,
      aiNullCells: measurement.counts?.aiNullCells ?? null,
      unresolvedCells: measurement.unresolvedCells,
      reviewCells: measurement.reviewCells,
      wouldFallback: measurement.wouldFallback,
      ocrMs,
      coldStart: deps.coldStart,
      rssMb: (deps.readRssMb ?? readProcessRssMb)(),
    });
  } catch (error: unknown) {
    console.warn('[ocr-shadow] result insert failed', { name: describeError(error) });
  }

  return measurement.status;
};
