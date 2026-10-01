import 'server-only';

import { sql } from 'drizzle-orm';

import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { computeSameNameLabels } from '@/domain/TeamRowKey';
import { type AckTeamChangesRequest } from '@/domain/types/api/AckTeamChangesRequest';
import { type AckTeamChangesResponse } from '@/domain/types/api/AckTeamChangesResponse';
import { type TeamMyMonthDto } from '@/domain/types/api/TeamMyMonthDto';
import { type TeamMyMonthsResponse } from '@/domain/types/api/TeamMyMonthsResponse';
import { type TeamRosterViewResponse } from '@/domain/types/api/TeamRosterViewResponse';
import { isValidYearMonth } from '@/domain/YearMonth';
import { type DbExecutor } from '@/server/db/Database';
import { memberChangeAcks } from '@/server/db/Schema';
import { ApiError } from '@/server/errors/ApiError';
import { type RequestContext } from '@/server/http/RequestContext';
import { isTeamAdmin, requireActiveMember } from '@/server/services/TeamAccess';
import {
  buildTeamMonthInfo,
  findAcknowledgedRevision,
  listTeamMonthsForUser,
} from '@/server/services/TeamMonthLookup';
import { findPublishedRoster, listRosterRows, toCodeEntries } from '@/server/services/TeamRosterRows';

/** GET /api/teams/:id/my-months (ACTIVE): the member's own row of every published month of this team. */
export const getMyTeamMonths = async (
  db: DbExecutor,
  context: RequestContext,
  teamId: string,
): Promise<TeamMyMonthsResponse> => {
  const { context: loggedIn, team, membership } = await requireActiveMember(db, context, teamId);
  const records = await listTeamMonthsForUser(db, loggedIn.user.id, { teamId: team.id });
  const months: TeamMyMonthDto[] = [];

  for (const record of records) {
    const info = await buildTeamMonthInfo(db, record, loggedIn.user.id);

    months.push({
      yearMonth: record.yearMonth,
      revision: record.revision,
      publishedAt: info.publishedAt,
      displayName: record.displayName,
      definitions: record.definitions,
      entries: toCodeEntries(record.entries),
      changes: info.changes,
      acknowledgedRevision: info.acknowledgedRevision,
    });
  }

  return { team: { id: team.id, name: team.name }, linkedRowKey: membership.linkedRowKey, months };
};

/**
 * GET /api/teams/:id/roster/:yearMonth: the latest published roster, names/dates/codes only. Members need the
 * team's `shareRosterWithMembers` on (read per request, so turning it off applies at once); admins always.
 */
export const getTeamRosterView = async (
  db: DbExecutor,
  context: RequestContext,
  teamId: string,
  yearMonth: string,
): Promise<TeamRosterViewResponse> => {
  const { team, membership } = await requireActiveMember(db, context, teamId);

  if (!isTeamAdmin(membership) && !team.shareRosterWithMembers) {
    throw new ApiError(ApiErrorCode.NOT_FOUND, { message: '관리자가 전체 근무표 공개를 꺼 두었어요.' });
  }

  const roster = isValidYearMonth(yearMonth) ? await findPublishedRoster(db, team.id, yearMonth) : null;

  if (!roster || roster.revision === null || !roster.publishedAt) {
    throw new ApiError(ApiErrorCode.NOT_FOUND);
  }

  const rows = (await listRosterRows(db, roster.id)).filter((row) => !row.excluded);
  const labels = computeSameNameLabels(rows.map((row) => row.displayName));

  return {
    teamId: team.id,
    teamName: team.name,
    yearMonth,
    revision: roster.revision,
    publishedAt: roster.publishedAt.toISOString(),
    definitions: roster.definitions,
    rows: rows.map((row, index) => ({
      rowKey: row.rowKey,
      displayName: row.displayName,
      sameNameOrdinal: labels[index]?.sameNameOrdinal ?? 1,
      sameNameCount: labels[index]?.sameNameCount ?? 1,
      entries: toCodeEntries(row.entries),
      isMine: row.rowKey === membership.linkedRowKey,
    })),
    myRowKey: membership.linkedRowKey,
  };
};

/**
 * POST /api/teams/:id/acks (ACTIVE): the "변경" marks of the month disappear up to `revision`. Capped at the
 * current published revision and never moved backwards. A month without the member's row → 404.
 */
export const acknowledgeTeamChanges = async (
  db: DbExecutor,
  context: RequestContext,
  teamId: string,
  body: AckTeamChangesRequest,
): Promise<AckTeamChangesResponse> => {
  const { context: loggedIn, team } = await requireActiveMember(db, context, teamId);
  const [record] = await listTeamMonthsForUser(db, loggedIn.user.id, {
    teamId: team.id,
    yearMonth: body.yearMonth,
  });

  if (!record) {
    throw new ApiError(ApiErrorCode.NOT_FOUND);
  }

  const current = await findAcknowledgedRevision(db, team.id, loggedIn.user.id, body.yearMonth);
  const acknowledgedRevision = Math.max(current, Math.min(body.revision, record.revision));

  await db
    .insert(memberChangeAcks)
    .values({
      teamId: team.id,
      userId: loggedIn.user.id,
      yearMonth: body.yearMonth,
      ackedRevision: acknowledgedRevision,
    })
    .onConflictDoUpdate({
      target: [memberChangeAcks.teamId, memberChangeAcks.userId, memberChangeAcks.yearMonth],
      // Never moves backwards, even with concurrent acks.
      set: { ackedRevision: sql`greatest(${memberChangeAcks.ackedRevision}, ${acknowledgedRevision})` },
    });

  return { yearMonth: body.yearMonth, acknowledgedRevision };
};
