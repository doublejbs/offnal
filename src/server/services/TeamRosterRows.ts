import 'server-only';

import { and, asc, desc, eq } from 'drizzle-orm';

import { TeamRosterStatus } from '@/domain/enums/TeamRosterStatus';
import { summarizeReview } from '@/domain/ScheduleValidator';
import { computeSameNameLabels } from '@/domain/TeamRowKey';
import { type JoinableRowDto } from '@/domain/types/api/JoinableRowDto';
import { type ShiftCodeEntry } from '@/domain/types/ShiftCodeEntry';
import { type ShiftEntry } from '@/domain/types/ShiftEntry';
import { type DbExecutor } from '@/server/db/Database';
import { type TeamRosterRow, type TeamRosterRowRow, teamRosterRows, teamRosters } from '@/server/db/Schema';

const FIRST_CODE_DAYS = 3;

export const listRosterRows = async (db: DbExecutor, rosterId: string): Promise<TeamRosterRowRow[]> =>
  db
    .select()
    .from(teamRosterRows)
    .where(eq(teamRosterRows.rosterId, rosterId))
    .orderBy(asc(teamRosterRows.position));

/** Latest published roster of a month, or (no month) of the most recent published month. */
export const findPublishedRoster = async (
  db: DbExecutor,
  teamId: string,
  yearMonth: string | null,
): Promise<TeamRosterRow | null> => {
  const conditions = [eq(teamRosters.teamId, teamId), eq(teamRosters.status, TeamRosterStatus.PUBLISHED)];

  if (yearMonth !== null) {
    conditions.push(eq(teamRosters.yearMonth, yearMonth));
  }

  const [roster] = await db
    .select()
    .from(teamRosters)
    .where(and(...conditions))
    .orderBy(desc(teamRosters.yearMonth))
    .limit(1);

  return roster ?? null;
};

export const listPublishedRosters = async (db: DbExecutor, teamId: string): Promise<TeamRosterRow[]> =>
  db
    .select()
    .from(teamRosters)
    .where(and(eq(teamRosters.teamId, teamId), eq(teamRosters.status, TeamRosterStatus.PUBLISHED)))
    .orderBy(asc(teamRosters.yearMonth));

/** Members see dates and codes only. */
export const toCodeEntries = (entries: ShiftEntry[]): ShiftCodeEntry[] =>
  entries.map((entry) => ({ date: entry.date, code: entry.code }));

/** Published entries for members: no review reasons (publishing required every date confirmed). */
export const toPublishedEntries = (entries: ShiftEntry[]): ShiftEntry[] =>
  entries.map((entry) => ({ date: entry.date, code: entry.code, reviewReasons: [], confirmed: true }));

export const countReviewDates = (entries: ShiftEntry[]): number => summarizeReview(entries).count;

/** Picker rows (non-excluded, in order) with same-name labels and the first 3 codes. */
export const toJoinableRows = (rows: TeamRosterRowRow[]): JoinableRowDto[] => {
  const included = rows.filter((row) => !row.excluded);
  const labels = computeSameNameLabels(included.map((row) => row.displayName));

  return included.map((row, index) => ({
    rowKey: row.rowKey,
    displayName: row.displayName,
    sameNameOrdinal: labels[index]?.sameNameOrdinal ?? 1,
    sameNameCount: labels[index]?.sameNameCount ?? 1,
    firstCodes: row.entries.slice(0, FIRST_CODE_DAYS).map((entry) => entry.code),
  }));
};

/** Re-numbers same display names after names were added or changed (stored for spec fidelity). */
export const refreshSameNameOrdinals = async (db: DbExecutor, rosterId: string): Promise<void> => {
  const rows = await listRosterRows(db, rosterId);
  const labels = computeSameNameLabels(rows.map((row) => row.displayName));

  for (const [index, row] of rows.entries()) {
    const sameNameOrdinal = labels[index]?.sameNameOrdinal ?? 1;

    if (row.sameNameOrdinal !== sameNameOrdinal) {
      await db.update(teamRosterRows).set({ sameNameOrdinal }).where(eq(teamRosterRows.id, row.id));
    }
  }
};
