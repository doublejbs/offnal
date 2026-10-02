import { OcrCellInk } from '@/domain/enums/OcrCellInk';
import { normalizePersonName } from '@/domain/PersonName';
import { type ExtractedCell } from '@/domain/types/ExtractedCell';
import { type PersonExtraction } from '@/domain/types/PersonExtraction';
import { daysInMonth } from '@/domain/YearMonth';
import { type OcrCell, type OcrRow, type OcrTable } from '@/server/vision/ocr/OcrTableTypes';

/** The hybrid hands a person to AI when OCR leaves at least this many cells unresolved (Spec §20). */
export const UNRESOLVED_FALLBACK_THRESHOLD = 3;

/** Row id of an OCR row (position among person rows; the "tap my row" index). */
export const toOcrRowId = (row: OcrRow): string => `ocr-row-${row.index + 1}`;

/** The one row whose OCR name equals `name` (NFC, spaces removed); null when absent or duplicated. */
export const findOcrRow = (table: OcrTable, name: string): OcrRow | null => {
  const target = normalizePersonName(name);
  const matches = table.rows.filter((row) => row.name !== null && normalizePersonName(row.name) === target);

  return matches.length === 1 ? matches[0]! : null;
};

/** A text cell OCR could not settle (no dictionary code): 확인 필요. */
export const isUnresolvedCell = (cell: OcrCell): boolean =>
  cell.ink === OcrCellInk.TEXT && cell.code === null;

/** Unresolved text cells plus days the grid does not reach (they would be MISSING_DATE). */
export const countUnresolved = (row: OcrRow, yearMonth: string): number =>
  row.cells.filter(isUnresolvedCell).length + Math.max(0, daysInMonth(yearMonth) - row.cells.length);

const toExtractedCell = (cell: OcrCell): ExtractedCell => {
  if (cell.ink === OcrCellInk.BLANK) {
    return { day: cell.day, rawText: null, code: null, ambiguous: false };
  }

  if (cell.ink === OcrCellInk.DASH) {
    return { day: cell.day, rawText: '-', code: null, ambiguous: false };
  }

  // A glyph-consensus code may come with an empty OCR reading; the decided code is what the cell says.
  const rawText = cell.code ?? (cell.token && cell.token.length > 0 ? cell.token : null);

  return { day: cell.day, rawText, code: cell.code, ambiguous: cell.code === null };
};

/**
 * One OCR row as the provider's second-pass shape, so `normalizeExtraction` applies unchanged: decided codes
 * as read, blank/dash cells null (unreadable, as for AI), unresolved text cells null and ambiguous.
 */
export const buildOcrExtraction = (table: OcrTable, row: OcrRow, yearMonth: string): PersonExtraction => ({
  yearMonth: table.yearMonth ?? yearMonth,
  rowId: toOcrRowId(row),
  displayName: row.name ?? '',
  definitions: table.definitions.map((definition) => ({ ...definition })),
  cells: row.cells.slice(0, daysInMonth(yearMonth)).map(toExtractedCell),
});
