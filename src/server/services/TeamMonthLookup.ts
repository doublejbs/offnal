import 'server-only';

import { and, asc, eq, inArray } from 'drizzle-orm';

import { TeamMemberStatus } from '@/domain/enums/TeamMemberStatus';
import { TeamRosterStatus } from '@/domain/enums/TeamRosterStatus';
import { collapseRevisionChanges } from '@/domain/TeamRosterDiff';
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

/** `${teamId}:${yearMonth}`: identifies one team month of a member (acks, share flags, changes). */
export const buildTeamMonthKey = (teamId: string, yearMonth: string): string => `${teamId}:${yearMonth}`;

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

/**
 * `TeamMonthInfo` for many team months with two queries in total (acks, then every candidate change), not
 * two per month. Changes of revisions after the acknowledged one are collapsed per date. Same order as input.
 */
export const buildTeamMonthInfos = async (
  db: DbExecutor,
  records: TeamMonthRecord[],
  userId: string,
): Promise<TeamMonthInfo[]> => {
  if (records.length === 0) {
    return [];
  }

  const teamIds = [...new Set(records.map((record) => record.teamId))];
  const yearMonths = [...new Set(records.map((record) => record.yearMonth))];
  const acks = await db
    .select()
    .from(memberChangeAcks)
    .where(
      and(
        eq(memberChangeAcks.userId, userId),
        inArray(memberChangeAcks.teamId, teamIds),
        inArray(memberChangeAcks.yearMonth, yearMonths),
      ),
    );
  const ackByKey = new Map(
    acks.map((ack) => [buildTeamMonthKey(ack.teamId, ack.yearMonth), ack.ackedRevision]),
  );
  const changes = await db
    .select({
      teamId: teamRosters.teamId,
      yearMonth: teamRosters.yearMonth,
      revision: teamRosters.revision,
      rowKey: teamRosterChanges.rowKey,
      date: teamRosterChanges.date,
      fromCode: teamRosterChanges.fromCode,
      toCode: teamRosterChanges.toCode,
    })
    .from(teamRosterChanges)
    .innerJoin(teamRosters, eq(teamRosters.id, teamRosterChanges.rosterId))
    .where(
      and(
        inArray(teamRosters.teamId, teamIds),
        inArray(teamRosters.yearMonth, yearMonths),
        inArray(teamRosterChanges.rowKey, [...new Set(records.map((record) => record.rowKey))]),
      ),
    );

  return records.map((record) => {
    const acknowledgedRevision = ackByKey.get(buildTeamMonthKey(record.teamId, record.yearMonth)) ?? 0;
    const own = changes.filter(
      (change) =>
        change.teamId === record.teamId &&
        change.yearMonth === record.yearMonth &&
        change.rowKey === record.rowKey &&
        (change.revision ?? 0) > acknowledgedRevision &&
        (change.revision ?? 0) <= record.revision,
    );

    return {
      teamId: record.teamId,
      teamName: record.teamName,
      revision: record.revision,
      publishedAt: record.publishedAt.toISOString(),
      changes: collapseRevisionChanges(
        own.map((change) => ({
          date: change.date,
          fromCode: change.fromCode,
          toCode: change.toCode,
          revision: change.revision ?? 0,
        })),
      ),
      acknowledgedRevision,
    };
  });
};

export const buildTeamMonthInfo = async (
  db: DbExecutor,
  record: TeamMonthRecord,
  userId: string,
): Promise<TeamMonthInfo> => {
  const [info] = await buildTeamMonthInfos(db, [record], userId);

  if (!info) {
    throw new Error('Team month info missing');
  }

  return info;
};

/** Keys (`buildTeamMonthKey`) of team months the member made visible on their share link. */
export const listSharedTeamMonthKeys = async (db: DbExecutor, userId: string): Promise<Set<string>> => {
  const rows = await db
    .select({ teamId: memberSharedTeamMonths.teamId, yearMonth: memberSharedTeamMonths.yearMonth })
    .from(memberSharedTeamMonths)
    .where(eq(memberSharedTeamMonths.userId, userId));

  return new Set(rows.map((row) => buildTeamMonthKey(row.teamId, row.yearMonth)));
};
