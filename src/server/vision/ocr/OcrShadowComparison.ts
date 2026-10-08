import { OcrShadowStatus } from '@/domain/enums/OcrShadowStatus';
import { normalizeExtraction } from '@/domain/ScheduleValidator';
import { type NormalizedSchedule } from '@/domain/types/NormalizedSchedule';
import {
  buildOcrExtraction,
  countReviewCells,
  countUnresolved,
  findOcrRow,
} from '@/server/vision/ocr/OcrPersonExtraction';
import { type OcrTableResult } from '@/server/vision/ocr/OcrTableTypes';

/**
 * Stage 2 (Spec §22) would hand a person to AI from the first unresolved cell, so the shadow statistics
 * use 1 (the eval's `ocr-then-ai` default stays 3).
 */
export const SHADOW_FALLBACK_THRESHOLD = 1;

/** Day-by-day agreement of the OCR schedule with the AI schedule (the reference, not the truth). */
export type ShadowCellCounts = {
  dayCount: number;
  /** Same code on both sides. */
  agreeCells: number;
  /** Both read a code, different ones: OCR may have produced a wrong value. */
  disagreeCells: number;
  /** AI read a code, OCR left the day null. */
  ocrNullCells: number;
  /** OCR read a code, AI left the day null. Days null on both sides are in no bucket. */
  aiNullCells: number;
};

export type ShadowMeasurement = {
  status: OcrShadowStatus;
  counts: ShadowCellCounts | null;
  unresolvedCells: number | null;
  reviewCells: number | null;
  wouldFallback: boolean;
};

const normalizeCode = (code: string | null): string | null =>
  code === null ? null : code.normalize('NFC').trim();

export const compareSchedules = (ai: NormalizedSchedule, ocr: NormalizedSchedule): ShadowCellCounts => {
  const ocrCodes = new Map(ocr.entries.map((entry) => [entry.date, normalizeCode(entry.code)]));
  const counts: ShadowCellCounts = {
    dayCount: ai.entries.length,
    agreeCells: 0,
    disagreeCells: 0,
    ocrNullCells: 0,
    aiNullCells: 0,
  };

  for (const entry of ai.entries) {
    const aiCode = normalizeCode(entry.code);
    const ocrCode = ocrCodes.get(entry.date) ?? null;

    if (aiCode !== null && ocrCode !== null) {
      if (aiCode === ocrCode) {
        counts.agreeCells += 1;
      } else {
        counts.disagreeCells += 1;
      }
    } else if (aiCode !== null) {
      counts.ocrNullCells += 1;
    } else if (ocrCode !== null) {
      counts.aiNullCells += 1;
    }
  }

  return counts;
};

/** No comparison (table/row failure, error, timeout or skip): stage 2 would hand the person to AI. */
export const FAILED_MEASUREMENT: Omit<ShadowMeasurement, 'status'> = {
  counts: null,
  unresolvedCells: null,
  reviewCells: null,
  wouldFallback: true,
};

/**
 * Compares what OCR read for `name` with the AI schedule of the same month. Pure: no names or codes leave
 * this function, only counts.
 */
export const measureOcrTable = (
  result: OcrTableResult,
  name: string,
  yearMonth: string,
  aiSchedule: NormalizedSchedule,
): ShadowMeasurement => {
  if (!result.ok) {
    return { status: OcrShadowStatus.TABLE_FAILED, ...FAILED_MEASUREMENT };
  }

  const row = findOcrRow(result.table, name);

  if (!row) {
    return { status: OcrShadowStatus.ROW_NOT_FOUND, ...FAILED_MEASUREMENT };
  }

  const ocrSchedule = normalizeExtraction(buildOcrExtraction(result.table, row, yearMonth), yearMonth);
  const unresolvedCells = countUnresolved(row, yearMonth);

  return {
    status: OcrShadowStatus.OK,
    counts: compareSchedules(aiSchedule, ocrSchedule),
    unresolvedCells,
    reviewCells: countReviewCells(ocrSchedule),
    wouldFallback: unresolvedCells >= SHADOW_FALLBACK_THRESHOLD,
  };
};
