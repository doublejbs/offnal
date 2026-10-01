import { getShiftTone } from '@/client/ShiftStyle';
import { MAX_ROW_ATTEMPTS } from '@/domain/DomainLimits';
import { PublishBlockReason } from '@/domain/enums/PublishBlockReason';
import { RosterRowExtractStatus } from '@/domain/enums/RosterRowExtractStatus';
import { ShiftTone } from '@/domain/enums/ShiftTone';
import { getPublishBlockers, summarizeReview } from '@/domain/ScheduleValidator';
import { type TeamRosterFailedRow } from '@/domain/types/api/TeamRosterFailedRow';
import { type TeamRosterRowBlocker } from '@/domain/types/api/TeamRosterRowBlocker';
import { type TeamRosterRowDto } from '@/domain/types/api/TeamRosterRowDto';
import { type PublishBlocker } from '@/domain/types/PublishBlocker';
import { type ShiftCodeEntry } from '@/domain/types/ShiftCodeEntry';
import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';
import { type ShiftEntry } from '@/domain/types/ShiftEntry';

/** Layout helpers of the people × days roster tables (admin review and read-only view). Pure. */

export type DayShiftCounts = {
  day: number;
  evening: number;
  night: number;
};

export type GridPosition = {
  row: number;
  column: number;
};

/** Per-date D/E/N head count (by tone, so custom codes never count as D/E/N). */
export const countShiftsByDate = (
  rows: { entries: ShiftCodeEntry[] }[],
  dates: string[],
  definitions: ShiftDefinition[],
): Map<string, DayShiftCounts> => {
  const counts = new Map<string, DayShiftCounts>(
    dates.map((date) => [date, { day: 0, evening: 0, night: 0 }]),
  );

  for (const row of rows) {
    for (const entry of row.entries) {
      const count = counts.get(entry.date);
      const tone = getShiftTone(entry.code, definitions);

      if (!count) {
        continue;
      }

      if (tone === ShiftTone.DAY) {
        count.day += 1;
      } else if (tone === ShiftTone.EVENING) {
        count.evening += 1;
      } else if (tone === ShiftTone.NIGHT) {
        count.night += 1;
      }
    }
  }

  return counts;
};

const GRID_KEY_DELTAS: Record<string, GridPosition> = {
  ArrowLeft: { row: 0, column: -1 },
  ArrowRight: { row: 0, column: 1 },
  ArrowUp: { row: -1, column: 0 },
  ArrowDown: { row: 1, column: 0 },
};

/** Roving focus in a rows × columns grid: arrows move one cell, Home/End jump within the row. Null = ignore. */
export const findGridTarget = (
  key: string,
  from: GridPosition,
  rowCount: number,
  columnCount: number,
): GridPosition | null => {
  if (key === 'Home') {
    return { row: from.row, column: 0 };
  }

  if (key === 'End') {
    return { row: from.row, column: columnCount - 1 };
  }

  const delta = GRID_KEY_DELTAS[key];

  if (!delta) {
    return null;
  }

  const row = from.row + delta.row;
  const column = from.column + delta.column;

  if (row < 0 || row >= rowCount || column < 0 || column >= columnCount) {
    return null;
  }

  return { row, column };
};

/** Review dates of a row with the current (local) legend. Excluded rows never need review. */
export const countRowReview = (row: TeamRosterRowDto): number =>
  row.excluded ? 0 : summarizeReview(row.entries).count;

/** Client-side mirror of the server's publish blockers, so the list follows unsaved edits. */
export const collectRosterBlockers = (
  rows: TeamRosterRowDto[],
  definitions: ShiftDefinition[],
): TeamRosterRowBlocker[] =>
  rows
    .filter((row) => !row.excluded)
    .map((row) => ({
      rowId: row.id,
      rowKey: row.rowKey,
      displayName: row.displayName,
      blockers: getPublishBlockers(row.entries, definitions),
    }))
    .filter((row) => row.blockers.length > 0);

/** Entries of every included row (legend usage, undefined codes). */
export const listIncludedEntries = (rows: TeamRosterRowDto[]): ShiftEntry[] =>
  rows.filter((row) => !row.excluded).flatMap((row) => row.entries);

/** First date a blocker points at in that row (for focusing the cell), else null. */
export const findBlockerDate = (blocker: PublishBlocker, entries: ShiftEntry[]): string | null => {
  if (blocker.reason === PublishBlockReason.UNCONFIRMED_DATES) {
    return blocker.dates[0] ?? null;
  }

  return entries.find((entry) => entry.code !== null && blocker.codes.includes(entry.code))?.date ?? null;
};

/** Blockers solved in the legend editor (times / definitions) rather than in a cell. */
export const isLegendBlocker = (blocker: PublishBlocker): boolean =>
  blocker.reason !== PublishBlockReason.UNCONFIRMED_DATES;

/** Rows that can be picked for "이름 바뀜": new people of this draft that are not excluded. */
export const listRenameCandidates = (rows: TeamRosterRowDto[]): TeamRosterRowDto[] =>
  rows.filter((row) => row.isNewPerson && !row.excluded);

/** FAILED, included rows as the failed-row list (seeds the list on resume; retry while attempts remain). */
export const listFailedRows = (rows: TeamRosterRowDto[]): TeamRosterFailedRow[] =>
  rows
    .filter((row) => !row.excluded && row.extractStatus === RosterRowExtractStatus.FAILED)
    .map((row) => ({
      rowId: row.id,
      displayName: row.displayName,
      attemptCount: row.attemptCount,
      errorCode: row.extractErrorCode,
      retryable: row.attemptCount < MAX_ROW_ATTEMPTS,
    }));

/** Union by row id; `later` wins. */
export const mergeFailedRows = (
  earlier: TeamRosterFailedRow[],
  later: TeamRosterFailedRow[],
): TeamRosterFailedRow[] => [
  ...earlier.filter((row) => !later.some((item) => item.rowId === row.rowId)),
  ...later,
];
