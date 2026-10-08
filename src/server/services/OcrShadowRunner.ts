import 'server-only';

import sharp from 'sharp';

import { OcrShadowErrorKind } from '@/domain/enums/OcrShadowErrorKind';
import { OcrShadowStatus } from '@/domain/enums/OcrShadowStatus';
import { type NormalizedSchedule } from '@/domain/types/NormalizedSchedule';
import { type DbExecutor } from '@/server/db/Database';
import { ocrShadowRuns } from '@/server/db/Schema';
import { describeError } from '@/server/errors/ErrorName';
import { OcrEngineError } from '@/server/vision/ocr/OcrEngineError';
import { type OcrProvider } from '@/server/vision/ocr/OcrProvider';
import {
  FAILED_MEASUREMENT,
  measureOcrTable,
  type ShadowMeasurement,
} from '@/server/vision/ocr/OcrShadowComparison';
import { readOcrTable } from '@/server/vision/ocr/OcrTableReader';
import { type OcrTableResult } from '@/server/vision/ocr/OcrTableTypes';
import { decodeRaw } from '@/server/vision/RawImageCodec';
import { type RawImage } from '@/server/vision/VisionGeometry';

const BYTES_PER_MB = 1024 * 1024;

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
  readTable?: (source: RawImage, ocr: OcrProvider, signal: AbortSignal) => Promise<OcrTableResult>;
  readRssMb?: () => number;
};

type ShadowRunValues = typeof ocrShadowRuns.$inferInsert;

class OcrShadowTimeoutError extends Error {
  constructor() {
    super('OCR shadow run timed out');
    this.name = 'OcrShadowTimeoutError';
  }
}

/** Process RSS right after the run (a snapshot, not the peak: workers and buffers may already be freed). */
export const readProcessRssMb = (): number => Math.round(process.memoryUsage().rss / BYTES_PER_MB);

/** The engine's own classification, otherwise the kind of the step that was running. */
const classifyError = (error: unknown, stepKind: OcrShadowErrorKind): OcrShadowErrorKind =>
  error instanceof OcrEngineError ? error.kind : stepKind;

/** EXIF orientation applied like the eval and the provider copy, then raw RGB for the OCR reader. */
const decodeSource = async (bytes: Buffer): Promise<RawImage> =>
  decodeRaw(await sharp(bytes).rotate().toBuffer());

const insertRun = async (db: DbExecutor, values: ShadowRunValues): Promise<void> => {
  try {
    await db.insert(ocrShadowRuns).values(values);
  } catch (error: unknown) {
    console.warn('[ocr-shadow] result insert failed', { name: describeError(error) });
  }
};

/** Measurement columns of a row (timing, cold start and memory are added by the caller). */
const toRunValues = (jobId: string, measurement: ShadowMeasurement) => ({
  jobId,
  status: measurement.status,
  dayCount: measurement.counts?.dayCount ?? null,
  agreeCells: measurement.counts?.agreeCells ?? null,
  disagreeCells: measurement.counts?.disagreeCells ?? null,
  ocrNullCells: measurement.counts?.ocrNullCells ?? null,
  aiNullCells: measurement.counts?.aiNullCells ?? null,
  unresolvedCells: measurement.unresolvedCells,
  reviewCells: measurement.reviewCells,
  wouldFallback: measurement.wouldFallback,
});

/**
 * Records a sampled run that did not start (`skipped_busy` or `skipped_budget`) or failed on engine load.
 * No measurement, counted as a fallback. Never throws.
 */
export const recordOcrShadowSkip = async (
  db: DbExecutor,
  jobId: string,
  status: OcrShadowStatus,
  readRssMb: () => number = readProcessRssMb,
  errorName: OcrShadowErrorKind | null = null,
): Promise<void> => {
  await insertRun(db, {
    ...toRunValues(jobId, { status, ...FAILED_MEASUREMENT }),
    errorName,
    ocrMs: 0,
    coldStart: false,
    rssMb: readRssMb(),
  });
};

type TableReadDeps = {
  ocr: OcrProvider;
  timeoutMs: number;
  readTable?: OcrShadowDeps['readTable'];
};

/** Outcome of one bounded table read: the value built from the table, or how it failed. */
type TimedTableRead<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      status: OcrShadowStatus.TIMEOUT | OcrShadowStatus.ERROR;
      errorKind: OcrShadowErrorKind | null;
    };

/**
 * Decodes the photo and reads its table within `timeoutMs`, then maps the table with `finish` (inside the
 * same budget). Never throws. On timeout the table reader is aborted, so it stops queueing and running OCR
 * jobs; an error carries the engine classification or the kind of the step that was running.
 */
const readTableWithin = async <T>(
  deps: TableReadDeps,
  sourceBytes: Buffer,
  finish: (result: OcrTableResult) => T,
): Promise<TimedTableRead<T>> => {
  const readTable = deps.readTable ?? readOcrTable;
  const controller = new AbortController();
  // Kind recorded for a failure without an engine classification, advanced as the run moves on.
  let stepKind = OcrShadowErrorKind.DECODE;
  let timer: NodeJS.Timeout | undefined;

  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = new OcrShadowTimeoutError();

      controller.abort(error);
      reject(error);
    }, deps.timeoutMs);
    timer.unref();
  });

  const work = (async () => {
    const source = await decodeSource(sourceBytes);

    stepKind = OcrShadowErrorKind.TABLE;

    const result = await readTable(source, deps.ocr, controller.signal);

    stepKind = OcrShadowErrorKind.UNKNOWN;

    return finish(result);
  })();

  // The losing side of the race must not become an unhandled rejection.
  work.catch(() => undefined);

  try {
    return { ok: true, value: await Promise.race([work, timeout]) };
  } catch (error: unknown) {
    if (error instanceof OcrShadowTimeoutError) {
      return { ok: false, status: OcrShadowStatus.TIMEOUT, errorKind: null };
    }

    return { ok: false, status: OcrShadowStatus.ERROR, errorKind: classifyError(error, stepKind) };
  } finally {
    clearTimeout(timer);
  }
};

/**
 * One shadow OCR run (Spec §22): reads the photo without AI, compares the chosen person with the AI result
 * and stores numbers only. Never throws — every failure becomes a row (or, if even the insert fails, a
 * warning with the error class name). On timeout the table reader is aborted.
 */
export const runOcrShadow = async (deps: OcrShadowDeps, input: OcrShadowInput): Promise<OcrShadowStatus> => {
  const now = deps.now ?? (() => performance.now());
  // Includes waiting for the shared workers (and starting them on a cold start), not only recognition.
  const startedAt = now();
  const read = await readTableWithin(deps, input.sourceBytes, (result) =>
    measureOcrTable(result, input.name, input.yearMonth, input.aiSchedule),
  );
  const measurement: ShadowMeasurement = read.ok
    ? read.value
    : { status: read.status, ...FAILED_MEASUREMENT };

  await insertRun(deps.db, {
    ...toRunValues(input.jobId, measurement),
    errorName: read.ok ? null : read.errorKind,
    ocrMs: Math.max(0, Math.round(now() - startedAt)),
    coldStart: deps.coldStart,
    rssMb: (deps.readRssMb ?? readProcessRssMb)(),
  });

  return measurement.status;
};

/** Numbers of a probe table read (Spec §22-11): never any text, name or code. */
export type OcrTableProbe = {
  status: OcrShadowStatus;
  errorName: OcrShadowErrorKind | null;
  tableFound: boolean;
  rowCount: number;
};

/** Table reading only on a posted photo (the probe request): nothing is stored. Never throws. */
export const probeOcrTable = async (deps: TableReadDeps, sourceBytes: Buffer): Promise<OcrTableProbe> => {
  const read = await readTableWithin(deps, sourceBytes, (result) => ({
    tableFound: result.ok,
    rowCount: result.ok ? result.table.rows.length : 0,
  }));

  if (!read.ok) {
    return { status: read.status, errorName: read.errorKind, tableFound: false, rowCount: 0 };
  }

  return {
    status: read.value.tableFound ? OcrShadowStatus.OK : OcrShadowStatus.TABLE_FAILED,
    errorName: null,
    ...read.value,
  };
};
