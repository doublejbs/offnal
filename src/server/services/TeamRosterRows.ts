import 'server-only';

import { and, asc, desc, eq, inArray, max } from 'drizzle-orm';

import { TeamRosterStatus } from '@/domain/enums/TeamRosterStatus';
import { normalizeExtraction, summarizeReview } from '@/domain/ScheduleValidator';
import { computeSameNameLabels } from '@/domain/TeamRowKey';
import { type JoinableRowDto } from '@/domain/types/api/JoinableRowDto';
import { type NormalizedSchedule } from '@/domain/types/NormalizedSchedule';
import { type ShiftCodeEntry } from '@/domain/types/ShiftCodeEntry';
import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';
import { type ShiftEntry } from '@/domain/types/ShiftEntry';
import { type DbExecutor } from '@/server/db/Database';
import {
  type RecognitionJobRow,
  recognitionJobs,
  type TeamRosterRow,
  type TeamRosterRowRow,
  teamRosterRows,
  teamRosters,
} from '@/server/db/Schema';

const FIRST_CODE_DAYS = 3;

export const listRosterRows = async (db: DbExecutor, rosterId: string): Promise<TeamRosterRowRow[]> =>
  db
    .select()
    .from(teamRosterRows)
    .where(eq(teamRosterRows.rosterId, rosterId))
    .orderBy(asc(teamRosterRows.position));

/** Rows of several rosters in one query, grouped by roster (each group by position). */
export const listRowsByRoster = async (
  db: DbExecutor,
  rosterIds: string[],
): Promise<Map<string, TeamRosterRowRow[]>> => {
  const grouped = new Map<string, TeamRosterRowRow[]>(rosterIds.map((id) => [id, []]));

  if (rosterIds.length === 0) {
    return grouped;
  }

  const rows = await db
    .select()
    .from(teamRosterRows)
    .where(inArray(teamRosterRows.rosterId, rosterIds))
    .orderBy(asc(teamRosterRows.position));

  for (const row of rows) {
    grouped.get(row.rosterId)?.push(row);
  }

  return grouped;
};

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

/** Highest published revision number of a team month (0 = never published). */
export const findLatestRevision = async (
  db: DbExecutor,
  teamId: string,
  yearMonth: string,
): Promise<number> => {
  const [row] = await db
    .select({ value: max(teamRosters.revision) })
    .from(teamRosters)
    .where(and(eq(teamRosters.teamId, teamId), eq(teamRosters.yearMonth, yearMonth)));

  return row?.value ?? 0;
};

/** The upload's recognition job (null for copies made by edit/revert, or once the job is gone). */
export const findRosterJob = async (
  db: DbExecutor,
  roster: TeamRosterRow,
): Promise<RecognitionJobRow | null> => {
  if (!roster.sourceJobId) {
    return null;
  }

  const [job] = await db
    .select()
    .from(recognitionJobs)
    .where(eq(recognitionJobs.id, roster.sourceJobId))
    .limit(1);

  return job ?? null;
};

/** Every date of the month empty (MISSING_DATE) with the given legend normalized. */
export const buildEmptyMonth = (yearMonth: string, definitions: ShiftDefinition[]): NormalizedSchedule =>
  normalizeExtraction({ yearMonth, rowId: '', displayName: '', definitions, cells: [] }, yearMonth);

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
