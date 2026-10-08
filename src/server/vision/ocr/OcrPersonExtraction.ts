import { countReviewEntries } from '@/domain/DraftReviewStats';
import { OcrCellInk } from '@/domain/enums/OcrCellInk';
import { normalizePersonName } from '@/domain/PersonName';
import { type ExtractedCell } from '@/domain/types/ExtractedCell';
import { type NormalizedSchedule } from '@/domain/types/NormalizedSchedule';
import { type PersonExtraction } from '@/domain/types/PersonExtraction';
import { daysInMonth } from '@/domain/YearMonth';
import { type OcrCell, type OcrRow, type OcrTable } from '@/server/vision/ocr/OcrTableTypes';

/**
 * The hybrid hands a person to AI when OCR leaves at least this many cells unresolved (Spec §21-8).
 * Counted with `countUnresolved` (cells OCR could not settle), not `countReviewCells`: AI would read a
 * blank or dash cell as null too, so those cells are no reason to pay for AI.
 */
export const UNRESOLVED_FALLBACK_THRESHOLD = 3;

/** Row id of an OCR row (position among person rows; the "tap my row" index). */
export const toOcrRowId = (row: OcrRow): string => `ocr-row-${row.index + 1}`;

/** The one row whose OCR name equals `name` (NFC, spaces removed); null when absent or duplicated. */
export const findOcrRow = (table: OcrTable, name: string): OcrRow | null => {
  const target = normalizePersonName(name);
  const matches = table.rows.filter((row) => row.name !== null && normalizePersonName(row.name) === target);

  return matches.length === 1 ? matches[0]! : null;
};

/** A cell OCR could not settle: text without a dictionary code, or faint ink (확인 필요 either way). */
export const isUnresolvedCell = (cell: OcrCell): boolean =>
  (cell.ink === OcrCellInk.TEXT && cell.code === null) || cell.ink === OcrCellInk.AMBIGUOUS;

/** Unresolved cells plus days the grid does not reach (they would be MISSING_DATE): the fallback count. */
export const countUnresolved = (row: OcrRow, yearMonth: string): number =>
  row.cells.filter(isUnresolvedCell).length + Math.max(0, daysInMonth(yearMonth) - row.cells.length);

/** Blank or dash cells of the month (`normalizeExtraction` makes them UNREADABLE, as for AI). */
export const countBlankCells = (row: OcrRow, yearMonth: string): number =>
  row.cells
    .slice(0, daysInMonth(yearMonth))
    .filter((cell) => cell.ink === OcrCellInk.BLANK || cell.ink === OcrCellInk.DASH).length;

/**
 * Days the user must confirm after `normalizeExtraction` (same rule for OCR and AI results): no code
 * (UNREADABLE — blank and dash included —, MISSING_DATE, DUPLICATE_DATE) or AMBIGUOUS. UNDEFINED_CODE
 * alone is not counted: the code was read, only its times are missing, whichever pipeline read it.
 */
export const countReviewCells = (schedule: NormalizedSchedule): number =>
  countReviewEntries(schedule.entries);

const toExtractedCell = (cell: OcrCell): ExtractedCell => {
  if (cell.ink === OcrCellInk.BLANK) {
    return { day: cell.day, rawText: null, code: null, ambiguous: false };
  }

  if (cell.ink === OcrCellInk.DASH) {
    return { day: cell.day, rawText: '-', code: null, ambiguous: false };
  }

  if (cell.ink === OcrCellInk.AMBIGUOUS) {
    return { day: cell.day, rawText: null, code: null, ambiguous: true };
  }

  // A glyph-consensus code may come with an empty OCR reading; the decided code is what the cell says.
  const rawText = cell.code ?? (cell.token && cell.token.length > 0 ? cell.token : null);

  return { day: cell.day, rawText, code: cell.code, ambiguous: cell.code === null };
};

/**
 * One OCR row as the provider's second-pass shape, so `normalizeExtraction` applies unchanged: decided codes
 * as read, blank/dash cells null (unreadable, as for AI), unresolved and faint cells null and ambiguous.
 * `yearMonth` is the target month (the one `normalizeExtraction` gets); the title month OCR read is scored
 * separately and not used here, so the stored month and the day truncation never disagree.
 */
export const buildOcrExtraction = (table: OcrTable, row: OcrRow, yearMonth: string): PersonExtraction => ({
  yearMonth,
  rowId: toOcrRowId(row),
  displayName: row.name ?? '',
  definitions: table.definitions.map((definition) => ({ ...definition })),
  cells: row.cells.slice(0, daysInMonth(yearMonth)).map(toExtractedCell),
});
