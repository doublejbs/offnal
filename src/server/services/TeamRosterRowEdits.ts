import 'server-only';

import { MAX_ROSTER_ROWS } from '@/domain/DomainLimits';
import { remapDraftMonth } from '@/domain/DraftMonthRemapper';
import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { RosterRowExtractStatus } from '@/domain/enums/RosterRowExtractStatus';
import { hasExactDateSet } from '@/domain/ScheduleValidator';
import { type PatchTeamRosterRequest } from '@/domain/types/api/PatchTeamRosterRequest';
import { type TeamRosterRowPatch } from '@/domain/types/api/TeamRosterRowPatch';
import { type ShiftEntry } from '@/domain/types/ShiftEntry';
import { type SourceCell } from '@/domain/types/SourceCell';
import { dayOfDate, listDates } from '@/domain/YearMonth';
import { type TeamRosterRowRow, type teamRosterRows } from '@/server/db/Schema';
import { ApiError } from '@/server/errors/ApiError';
import { normalizeEntries } from '@/server/services/DraftService';
import { classifyRow, isRowBusy } from '@/server/services/TeamRosterProgressBuilder';

/**
 * Row-level pieces of roster PATCH: validation, per-row writes, change detection.
 */

export const ROW_BUSY_MESSAGE = '아직 읽는 중인 사람이 있어요. 읽기가 끝난 뒤 고쳐 주세요.';

export const validationError = (message: string, field: string): ApiError =>
  new ApiError(ApiErrorCode.VALIDATION_ERROR, { message, details: { fields: [field] } });

export const requireMonthEntries = (entries: ShiftEntry[], yearMonth: string): ShiftEntry[] => {
  if (!hasExactDateSet(entries, yearMonth)) {
    throw validationError('대상 월의 모든 날짜가 한 번씩 있어야 해요.', 'entries');
  }

  return normalizeEntries(entries);
};

const remapSourceCells = (cells: SourceCell[], toYearMonth: string): SourceCell[] => {
  const byDay = new Map(cells.map((cell) => [dayOfDate(cell.date), cell.rawText]));

  return listDates(toYearMonth).map((date) => ({ date, rawText: byDay.get(dayOfDate(date)) ?? null }));
};

type RowWrite = {
  rowKey?: string;
  displayName?: string;
  entries?: ShiftEntry[];
  sourceCells?: SourceCell[];
  excluded?: boolean;
  extractStatus?: RosterRowExtractStatus;
};

export const buildRowWrite = (
  row: TeamRosterRowRow,
  patch: TeamRosterRowPatch | undefined,
  context: {
    fromYearMonth: string;
    yearMonth: string;
    previousKeys: Set<string>;
    usedKeys: Set<string>;
    now: Date;
  },
): RowWrite => {
  const write: RowWrite = {};

  if (patch && isRowBusy(row, context.now)) {
    throw new ApiError(ApiErrorCode.ROSTER_NOT_EDITABLE, { message: ROW_BUSY_MESSAGE });
  }

  if (context.yearMonth !== context.fromYearMonth) {
    write.entries = remapDraftMonth(row.entries, context.fromYearMonth, context.yearMonth);
    write.sourceCells = remapSourceCells(row.sourceCells, context.yearMonth);
  }

  if (!patch) {
    return write;
  }

  if (patch.entries) {
    write.entries = requireMonthEntries(patch.entries, context.yearMonth);
    // Classified, not raw: a PROCESSING row whose last lease ran out counts as FAILED and becomes MANUAL.
    write.extractStatus =
      classifyRow(row, context.now) === RosterRowExtractStatus.FAILED
        ? RosterRowExtractStatus.MANUAL
        : row.extractStatus;
  }

  if (patch.displayName !== undefined) {
    write.displayName = patch.displayName;
  }

  if (patch.excluded !== undefined) {
    write.excluded = patch.excluded;
  }

  if (patch.matchRowKey !== undefined && patch.matchRowKey !== row.rowKey) {
    if (!context.previousKeys.has(patch.matchRowKey) || context.usedKeys.has(patch.matchRowKey)) {
      throw validationError(
        '이전 근무표에 있고 이 초안에서 쓰이지 않은 사람만 이어 붙일 수 있어요.',
        'matchRowKey',
      );
    }

    context.usedKeys.delete(row.rowKey);
    context.usedKeys.add(patch.matchRowKey);
    write.rowKey = patch.matchRowKey;
  }

  return write;
};

export type RowState = {
  rowKey: string;
  displayName: string;
  entries: ShiftEntry[];
  sourceCells: SourceCell[];
  excluded: boolean;
  extractStatus: RosterRowExtractStatus;
  position: number;
};

export const toState = (row: TeamRosterRowRow): RowState => ({
  rowKey: row.rowKey,
  displayName: row.displayName,
  entries: row.entries,
  sourceCells: row.sourceCells,
  excluded: row.excluded,
  extractStatus: row.extractStatus,
  position: row.position,
});

/** Only the columns that differ (JSON columns compared by value). */
export const diffRowState = (
  before: TeamRosterRowRow,
  after: RowState & { sameNameOrdinal: number; reviewCount: number },
): Partial<typeof teamRosterRows.$inferInsert> => {
  const changes: Partial<typeof teamRosterRows.$inferInsert> = {};
  const current = {
    ...toState(before),
    sameNameOrdinal: before.sameNameOrdinal,
    reviewCount: before.reviewCount,
  };

  for (const key of Object.keys(after) as (keyof typeof after)[]) {
    if (JSON.stringify(after[key]) !== JSON.stringify(current[key])) {
      Object.assign(changes, { [key]: after[key] });
    }
  }

  return changes;
};

export const validatePatch = (
  rows: TeamRosterRowRow[],
  body: PatchTeamRosterRequest,
  monthChanges: boolean,
  now: Date,
): void => {
  const patches = body.rows ?? [];
  const ids = new Set(rows.map((row) => row.id));

  if (
    patches.some((patch) => !ids.has(patch.rowId)) ||
    new Set(patches.map((patch) => patch.rowId)).size !== patches.length
  ) {
    throw validationError('근무표에 없는 행이에요.', 'rows');
  }

  if (rows.length + (body.addRows?.length ?? 0) > MAX_ROSTER_ROWS) {
    throw validationError(`한 근무표에는 ${MAX_ROSTER_ROWS}명까지 넣을 수 있어요.`, 'addRows');
  }

  // Rows being read would store the old month's dates: change the month once reading finished.
  if (monthChanges && rows.some((row) => isRowBusy(row, now))) {
    throw new ApiError(ApiErrorCode.ROSTER_NOT_EDITABLE, { message: ROW_BUSY_MESSAGE });
  }
};
