import { PublishBlockReason } from '@/domain/enums/PublishBlockReason';
import { ShiftReviewReason } from '@/domain/enums/ShiftReviewReason';
import { hasCompleteTimes } from '@/domain/ShiftTime';
import { type ExtractedCell } from '@/domain/types/ExtractedCell';
import { type NormalizedSchedule } from '@/domain/types/NormalizedSchedule';
import { type PersonExtraction } from '@/domain/types/PersonExtraction';
import { type PublishBlocker } from '@/domain/types/PublishBlocker';
import { type ReviewSummary } from '@/domain/types/ReviewSummary';
import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';
import { type ShiftEntry } from '@/domain/types/ShiftEntry';
import { type SourceCell } from '@/domain/types/SourceCell';
import { daysInMonth, listDates } from '@/domain/YearMonth';

export const MAX_CODE_LENGTH = 12;

/** Raw text made only of blanks, dashes or doubt marks is treated as unreadable (never as OFF). */
const UNREADABLE_RAW_PATTERN = /^[\s\-‐‑‒–—―ー_~?？.·•*/\\|]*$/u;

export const normalizeCode = (raw: string): string => raw.trim().toUpperCase().slice(0, MAX_CODE_LENGTH);

export const isValidCode = (code: string): boolean =>
  code.length > 0 && code.length <= MAX_CODE_LENGTH && code === normalizeCode(code);

const isUnreadableRawText = (rawText: string | null): boolean =>
  rawText === null || UNREADABLE_RAW_PATTERN.test(rawText);

const normalizeDefinitions = (definitions: ShiftDefinition[]): ShiftDefinition[] => {
  const byCode = new Map<string, ShiftDefinition>();

  for (const definition of definitions) {
    const code = normalizeCode(definition.code);

    if (code.length === 0 || byCode.has(code)) {
      continue;
    }

    byCode.set(code, { ...definition, code, label: definition.label.trim() || code });
  }

  return [...byCode.values()];
};

const buildPlaceholderDefinition = (code: string): ShiftDefinition => ({
  code,
  label: code,
  startTime: null,
  endTime: null,
  endsNextDay: null,
  isOff: false,
});

const groupCellsByDay = (cells: ExtractedCell[], dayCount: number): Map<number, ExtractedCell[]> => {
  const grouped = new Map<number, ExtractedCell[]>();

  for (const cell of cells) {
    if (!Number.isInteger(cell.day) || cell.day < 1 || cell.day > dayCount) {
      continue;
    }

    grouped.set(cell.day, [...(grouped.get(cell.day) ?? []), cell]);
  }

  return grouped;
};

const buildEntry = (date: string, code: string | null, reviewReasons: ShiftReviewReason[]): ShiftEntry => ({
  date,
  code,
  reviewReasons,
  confirmed: reviewReasons.length === 0 && code !== null,
});

export const normalizeExtraction = (extraction: PersonExtraction, yearMonth: string): NormalizedSchedule => {
  const dates = listDates(yearMonth);
  const cellsByDay = groupCellsByDay(extraction.cells, daysInMonth(yearMonth));
  const definitions = normalizeDefinitions(extraction.definitions);
  const knownCodes = new Set(definitions.map((definition) => definition.code));
  const addedCodes = new Set<string>();
  const entries: ShiftEntry[] = [];
  const sourceCells: SourceCell[] = [];

  dates.forEach((date, index) => {
    const cells = cellsByDay.get(index + 1) ?? [];
    const [cell] = cells;

    if (!cell) {
      entries.push(buildEntry(date, null, [ShiftReviewReason.MISSING_DATE]));
      sourceCells.push({ date, rawText: null });

      return;
    }

    sourceCells.push({ date, rawText: cells.length > 1 ? null : cell.rawText });

    if (cells.length > 1) {
      entries.push(buildEntry(date, null, [ShiftReviewReason.DUPLICATE_DATE]));

      return;
    }

    const code = cell.code === null ? '' : normalizeCode(cell.code);

    if (isUnreadableRawText(cell.rawText) || code.length === 0) {
      entries.push(buildEntry(date, null, [ShiftReviewReason.UNREADABLE]));

      return;
    }

    const reasons: ShiftReviewReason[] = [];

    if (cell.ambiguous) {
      reasons.push(ShiftReviewReason.AMBIGUOUS);
    }

    if (!knownCodes.has(code)) {
      reasons.push(ShiftReviewReason.UNDEFINED_CODE);
    }

    if (!knownCodes.has(code) && !addedCodes.has(code)) {
      addedCodes.add(code);
      definitions.push(buildPlaceholderDefinition(code));
    }

    entries.push(buildEntry(date, code, reasons));
  });

  return { entries, definitions, sourceCells };
};

export const getPublishBlockers = (
  entries: ShiftEntry[],
  definitions: ShiftDefinition[],
): PublishBlocker[] => {
  const definitionByCode = new Map(definitions.map((definition) => [definition.code, definition]));
  const unconfirmedDates = entries
    .filter((entry) => entry.code === null || !entry.confirmed)
    .map((entry) => entry.date);
  const usedCodes = [...new Set(entries.flatMap((entry) => (entry.code === null ? [] : [entry.code])))];
  const undefinedCodes = usedCodes.filter((code) => !definitionByCode.has(code));
  const missingTimeCodes = usedCodes.filter((code) => {
    const definition = definitionByCode.get(code);

    return definition !== undefined && !hasCompleteTimes(definition);
  });
  const blockers: PublishBlocker[] = [];

  if (unconfirmedDates.length > 0) {
    blockers.push({ reason: PublishBlockReason.UNCONFIRMED_DATES, dates: unconfirmedDates });
  }

  if (missingTimeCodes.length > 0) {
    blockers.push({ reason: PublishBlockReason.MISSING_TIMES, codes: missingTimeCodes.sort() });
  }

  if (undefinedCodes.length > 0) {
    blockers.push({ reason: PublishBlockReason.UNDEFINED_CODES, codes: undefinedCodes.sort() });
  }

  return blockers;
};

export const summarizeReview = (entries: ShiftEntry[]): ReviewSummary => {
  const dates = entries.filter((entry) => entry.code === null || !entry.confirmed).map((entry) => entry.date);

  return { count: dates.length, dates };
};

/** True when entries cover every date of the month exactly once and nothing else. */
export const hasExactDateSet = (entries: ShiftEntry[], yearMonth: string): boolean => {
  const expected = listDates(yearMonth);
  const actual = new Set(entries.map((entry) => entry.date));

  return (
    entries.length === expected.length &&
    actual.size === expected.length &&
    expected.every((date) => actual.has(date))
  );
};
