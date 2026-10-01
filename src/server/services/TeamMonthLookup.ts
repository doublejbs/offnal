import 'server-only';

import { and, asc, eq, gt, lte } from 'drizzle-orm';

import { TeamMemberStatus } from '@/domain/enums/TeamMemberStatus';
import { TeamRosterStatus } from '@/domain/enums/TeamRosterStatus';
import { collapseRevisionChanges } from '@/domain/TeamRosterDiff';
import { type TeamCellChange } from '@/domain/types/api/TeamCellChange';
import { type TeamMonthInfo } from '@/domain/types/api/TeamMonthInfo';
import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';
import { type ShiftEntry } from '@/domain/types/ShiftEntry';
import { type DbExecutor } from '@/server/db/Database';
import {
  memberChangeAcks,
  memberSharedTeamMonths,
  teamMembers,
  teamRosterChanges,
  teamRosterRows,
  teamRosters,
  teams,
} from '@/server/db/Schema';
import { toPublishedEntries } from '@/server/services/TeamRosterRows';

/** The member's row of the latest published revision of one team month. */
export type TeamMonthRecord = {
  teamId: string;
  teamName: string;
  rosterId: string;
  yearMonth: string;
  revision: number;
  publishedAt: Date;
  definitions: ShiftDefinition[];
  rowKey: string;
  displayName: string;
  /** Published entries without review data. */
  entries: ShiftEntry[];
};

/**
 * Team months of a user, read live (Team spec §5: never copied into published_months): ACTIVE memberships with
 * a linked row × the PUBLISHED roster of each month × that row (not excluded). Leaving or removal hides them at
 * once. When two teams publish the same month, the most recently published one wins. Ascending by month.
 */
export type TeamMonthFilter = {
  yearMonth?: string;
  /** Only this team (no cross-team precedence then). */
  teamId?: string;
};

export const listTeamMonthsForUser = async (
  db: DbExecutor,
  userId: string,
  filter: TeamMonthFilter = {},
): Promise<TeamMonthRecord[]> => {
  const conditions = [
    eq(teamMembers.userId, userId),
    eq(teamMembers.status, TeamMemberStatus.ACTIVE),
    eq(teamRosters.status, TeamRosterStatus.PUBLISHED),
    eq(teamRosterRows.excluded, false),
  ];

  if (filter.yearMonth !== undefined) {
    conditions.push(eq(teamRosters.yearMonth, filter.yearMonth));
  }

  if (filter.teamId !== undefined) {
    conditions.push(eq(teamMembers.teamId, filter.teamId));
  }

  const rows = await db
    .select({ team: teams, roster: teamRosters, row: teamRosterRows })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .innerJoin(teamRosters, eq(teamRosters.teamId, teamMembers.teamId))
    .innerJoin(
      teamRosterRows,
      and(eq(teamRosterRows.rosterId, teamRosters.id), eq(teamRosterRows.rowKey, teamMembers.linkedRowKey)),
    )
    .where(and(...conditions))
    .orderBy(asc(teamRosters.yearMonth), asc(teamRosters.publishedAt));
  const byMonth = new Map<string, TeamMonthRecord>();

  for (const { team, roster, row } of rows) {
    if (!roster.yearMonth || roster.revision === null || !roster.publishedAt) {
      continue;
    }

    // Later rows of the same month were published later (ordered above) and replace earlier ones.
    byMonth.set(roster.yearMonth, {
      teamId: team.id,
      teamName: team.name,
      rosterId: roster.id,
      yearMonth: roster.yearMonth,
      revision: roster.revision,
      publishedAt: roster.publishedAt,
      definitions: roster.definitions,
      rowKey: row.rowKey,
      displayName: row.displayName,
      entries: toPublishedEntries(row.entries),
    });
  }

  return [...byMonth.values()];
};

export const findTeamMonthForUser = async (
  db: DbExecutor,
  userId: string,
  yearMonth: string,
): Promise<TeamMonthRecord | null> => (await listTeamMonthsForUser(db, userId, { yearMonth }))[0] ?? null;

export const findAcknowledgedRevision = async (
  db: DbExecutor,
  teamId: string,
  userId: string,
  yearMonth: string,
): Promise<number> => {
  const [ack] = await db
    .select({ revision: memberChangeAcks.ackedRevision })
    .from(memberChangeAcks)
    .where(
      and(
        eq(memberChangeAcks.teamId, teamId),
        eq(memberChangeAcks.userId, userId),
        eq(memberChangeAcks.yearMonth, yearMonth),
      ),
    )
    .limit(1);

  return ack?.revision ?? 0;
};

/** Changed dates of the member's row in revisions after the acknowledged one (collapsed per date). */
export const loadUnacknowledgedChanges = async (
  db: DbExecutor,
  record: TeamMonthRecord,
  acknowledgedRevision: number,
): Promise<TeamCellChange[]> => {
  const rows = await db
    .select({
      revision: teamRosters.revision,
      date: teamRosterChanges.date,
      fromCode: teamRosterChanges.fromCode,
      toCode: teamRosterChanges.toCode,
    })
    .from(teamRosterChanges)
    .innerJoin(teamRosters, eq(teamRosters.id, teamRosterChanges.rosterId))
    .where(
      and(
        eq(teamRosters.teamId, record.teamId),
        eq(teamRosters.yearMonth, record.yearMonth),
        gt(teamRosters.revision, acknowledgedRevision),
        lte(teamRosters.revision, record.revision),
        eq(teamRosterChanges.rowKey, record.rowKey),
      ),
    );

  return collapseRevisionChanges(rows.map((row) => ({ ...row, revision: row.revision ?? 0 })));
};

export const buildTeamMonthInfo = async (
  db: DbExecutor,
  record: TeamMonthRecord,
  userId: string,
): Promise<TeamMonthInfo> => {
  const acknowledgedRevision = await findAcknowledgedRevision(db, record.teamId, userId, record.yearMonth);

  return {
    teamId: record.teamId,
    teamName: record.teamName,
    revision: record.revision,
    publishedAt: record.publishedAt.toISOString(),
    changes: await loadUnacknowledgedChanges(db, record, acknowledgedRevision),
    acknowledgedRevision,
  };
};

/** `${teamId}:${yearMonth}` keys of team months the member made visible on their share link. */
export const listSharedTeamMonthKeys = async (db: DbExecutor, userId: string): Promise<Set<string>> => {
  const rows = await db
    .select({ teamId: memberSharedTeamMonths.teamId, yearMonth: memberSharedTeamMonths.yearMonth })
    .from(memberSharedTeamMonths)
    .where(eq(memberSharedTeamMonths.userId, userId));

  return new Set(rows.map((row) => buildTeamMonthKey(row.teamId, row.yearMonth)));
};

export const buildTeamMonthKey = (teamId: string, yearMonth: string): string => `${teamId}:${yearMonth}`;
