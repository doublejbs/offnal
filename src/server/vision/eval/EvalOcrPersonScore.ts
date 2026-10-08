import { OcrFallbackReason } from '@/domain/enums/OcrFallbackReason';
import { VisionEvalPersonOutcome } from '@/domain/enums/VisionEvalPersonOutcome';
import { normalizeExtraction } from '@/domain/ScheduleValidator';
import { buildFailedPersonRun } from '@/server/vision/eval/EvalPersonRunner';
import { detectNeighbourRead, scorePerson } from '@/server/vision/eval/EvalScoring';
import { type EvalSample } from '@/server/vision/eval/EvalTruth';
import { type OcrPersonRecord, type PersonRun } from '@/server/vision/eval/EvalTypes';
import {
  buildOcrExtraction,
  countBlankCells,
  countReviewCells,
  countUnresolved,
  findOcrRow,
  toOcrRowId,
} from '@/server/vision/ocr/OcrPersonExtraction';
import { type OcrRow, type OcrTableResult } from '@/server/vision/ocr/OcrTableTypes';

export type OcrPerson = { run: PersonRun; row: OcrRow | null; fallback: OcrFallbackReason | null };

/**
 * Scores one truth person from the OCR table alone (null schedule = all days wrong, like a missed name).
 * `fallbackThreshold` unresolved cells hand the person to AI in `ocr-then-ai` (Spec §21-8).
 */
export const scoreOcrPerson = (
  sample: EvalSample,
  name: string,
  result: OcrTableResult,
  fallbackThreshold: number,
): OcrPerson => {
  const { truth } = sample;
  const base = { ocrLatencyMs: result.latencyMs, aiPass1: null };

  if (!result.ok) {
    const ocr: OcrPersonRecord = {
      ...base,
      nameFound: false,
      unresolvedCells: null,
      reviewCells: null,
      blankCells: null,
      finishedByOcr: false,
      fallback: OcrFallbackReason.TABLE_FAILED,
      tapRowCorrectDays: null,
      tapRowUnresolved: null,
    };

    return {
      run: { ...buildFailedPersonRun(truth, name, VisionEvalPersonOutcome.SCORED), ocr },
      row: null,
      fallback: OcrFallbackReason.TABLE_FAILED,
    };
  }

  const { table } = result;
  const toSchedule = (target: OcrRow) =>
    normalizeExtraction(buildOcrExtraction(table, target, truth.yearMonth), truth.yearMonth);
  // "Tap my row" (metric only): truth names are listed top to bottom, so the index is the row.
  const tapRow =
    table.rows.length === truth.allNames.length ? table.rows[truth.allNames.indexOf(name)] : undefined;
  const tap = tapRow
    ? {
        correct: scorePerson(truth, name, toOcrRowId(tapRow), toSchedule(tapRow)).correctDays,
        unresolved: countUnresolved(tapRow, truth.yearMonth),
      }
    : null;
  const row = findOcrRow(table, name);
  const schedule = row ? toSchedule(row) : null;
  const unresolvedCells = row ? countUnresolved(row, truth.yearMonth) : null;
  // Same rule as for AI results: every day `normalizeExtraction` leaves for the user to confirm.
  const reviewCells = schedule ? countReviewCells(schedule) : null;
  const fallback =
    row === null
      ? OcrFallbackReason.NAME_NOT_FOUND
      : unresolvedCells! >= fallbackThreshold
        ? OcrFallbackReason.UNRESOLVED_CELLS
        : null;
  const ocr: OcrPersonRecord = {
    ...base,
    nameFound: row !== null,
    unresolvedCells,
    reviewCells,
    blankCells: row ? countBlankCells(row, truth.yearMonth) : null,
    finishedByOcr: reviewCells === 0,
    fallback: null,
    tapRowCorrectDays: tap?.correct ?? null,
    tapRowUnresolved: tap?.unresolved ?? null,
  };

  if (!row || !schedule) {
    return {
      run: { ...buildFailedPersonRun(truth, name, VisionEvalPersonOutcome.SCORED), ocr },
      row,
      fallback,
    };
  }

  const neighbours = [table.rows[row.index - 1]?.name ?? null, table.rows[row.index + 1]?.name ?? null];

  return {
    run: {
      score: scorePerson(truth, name, toOcrRowId(row), schedule),
      outcome: VisionEvalPersonOutcome.SCORED,
      call: null,
      calls: [],
      route: null,
      fallback: null,
      identityVerified: true,
      neighbourRead: detectNeighbourRead(truth, name, neighbours, schedule),
      ocr,
    },
    row,
    fallback,
  };
};
