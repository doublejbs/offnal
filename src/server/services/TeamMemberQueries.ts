import 'server-only';

import { and, asc, count, eq, ne } from 'drizzle-orm';

import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { TeamMembershipConflictReason } from '@/domain/enums/TeamMembershipConflictReason';
import { TeamMemberStatus } from '@/domain/enums/TeamMemberStatus';
import { TeamRole } from '@/domain/enums/TeamRole';
import { type InviteRowsResponse } from '@/domain/types/api/InviteRowsResponse';
import { type JoinableRowDto } from '@/domain/types/api/JoinableRowDto';
import { type TeamMemberDto } from '@/domain/types/api/TeamMemberDto';
import { type TeamMemberListResponse } from '@/domain/types/api/TeamMemberListResponse';
import { type DbExecutor } from '@/server/db/Database';
import { type TeamMemberRow, teamMembers, users } from '@/server/db/Schema';
import { ApiError } from '@/server/errors/ApiError';
import { type RequestContext } from '@/server/http/RequestContext';
import { requireTeamAdmin, throwMembershipConflict } from '@/server/services/TeamAccess';
import { findValidInvite } from '@/server/services/TeamInviteService';
import { findPublishedRoster, listRosterRows, toJoinableRows } from '@/server/services/TeamRosterRows';
import { requireUser } from '@/server/validation/RequestGuards';

const ROW_NOT_FOUND_MESSAGE = '근무표에서 그 이름을 찾을 수 없어요. 목록에서 다시 골라 주세요.';

export type JoinableRows = {
  yearMonth: string | null;
  rows: JoinableRowDto[];
};

/** Non-excluded rows of the team's most recent published roster. */
const loadRosterRowsForLinking = async (db: DbExecutor, teamId: string): Promise<JoinableRows> => {
  const roster = await findPublishedRoster(db, teamId, null);

  if (!roster) {
    return { yearMonth: null, rows: [] };
  }

  return { yearMonth: roster.yearMonth, rows: toJoinableRows(await listRosterRows(db, roster.id)) };
};

export const listActiveLinkedKeys = async (
  db: DbExecutor,
  teamId: string,
  exceptUserId?: string,
): Promise<Set<string>> => {
  const rows = await db
    .select({ userId: teamMembers.userId, rowKey: teamMembers.linkedRowKey })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.status, TeamMemberStatus.ACTIVE)));

  return new Set(rows.flatMap((row) => (row.rowKey && row.userId !== exceptUserId ? [row.rowKey] : [])));
};

/** A row key a member may be linked to: it must exist in the latest published roster and be free. */
export const assertLinkableRow = async (
  db: DbExecutor,
  teamId: string,
  rowKey: string,
  exceptUserId?: string,
): Promise<void> => {
  const { rows } = await loadRosterRowsForLinking(db, teamId);

  if (!rows.some((row) => row.rowKey === rowKey)) {
    throw new ApiError(ApiErrorCode.VALIDATION_ERROR, {
      message: ROW_NOT_FOUND_MESSAGE,
      details: { fields: ['rowKey'] },
    });
  }

  if ((await listActiveLinkedKeys(db, teamId, exceptUserId)).has(rowKey)) {
    throwMembershipConflict(TeamMembershipConflictReason.ROW_TAKEN);
  }
};

const countActiveAdmins = async (db: DbExecutor, teamId: string, exceptUserId?: string): Promise<number> => {
  const conditions = [
    eq(teamMembers.teamId, teamId),
    eq(teamMembers.role, TeamRole.ADMIN),
    eq(teamMembers.status, TeamMemberStatus.ACTIVE),
  ];

  if (exceptUserId) {
    conditions.push(ne(teamMembers.userId, exceptUserId));
  }

  const [row] = await db
    .select({ value: count() })
    .from(teamMembers)
    .where(and(...conditions));

  return row?.value ?? 0;
};

/** Active members of the team (analytics `memberCount`). */
export const countActiveMembers = async (db: DbExecutor, teamId: string): Promise<number> => {
  const [row] = await db
    .select({ value: count() })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.status, TeamMemberStatus.ACTIVE)));

  return row?.value ?? 0;
};

/** Leaving/removal/demotion of an admin must leave at least one other active admin. */
export const assertNotLastAdmin = async (db: DbExecutor, membership: TeamMemberRow): Promise<void> => {
  if (membership.role !== TeamRole.ADMIN || membership.status !== TeamMemberStatus.ACTIVE) {
    return;
  }

  if ((await countActiveAdmins(db, membership.teamId, membership.userId)) === 0) {
    throwMembershipConflict(TeamMembershipConflictReason.LAST_ADMIN);
  }
};

const toTeamMemberDto = (
  membership: TeamMemberRow,
  displayName: string,
  rows: JoinableRowDto[],
  viewerId: string,
): TeamMemberDto => ({
  userId: membership.userId,
  displayName,
  role: membership.role,
  status: membership.status,
  linkedRowKey: membership.linkedRowKey,
  linkedRow: rows.find((row) => row.rowKey === membership.linkedRowKey) ?? null,
  requestedAt: membership.requestedAt.toISOString(),
  approvedAt: membership.approvedAt?.toISOString() ?? null,
  isMe: membership.userId === viewerId,
});

export const loadMemberDto = async (
  db: DbExecutor,
  teamId: string,
  userId: string,
  viewerId: string,
): Promise<TeamMemberDto> => {
  const [row] = await db
    .select({ membership: teamMembers, displayName: users.displayName })
    .from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.userId))
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))
    .limit(1);

  if (!row) {
    throw new ApiError(ApiErrorCode.NOT_FOUND);
  }

  const { rows } = await loadRosterRowsForLinking(db, teamId);

  return toTeamMemberDto(row.membership, row.displayName, rows, viewerId);
};

/** GET /api/teams/:id/members (ADMIN): PENDING requests (oldest first), then ACTIVE members. */
export const listMembers = async (
  db: DbExecutor,
  context: RequestContext,
  teamId: string,
): Promise<TeamMemberListResponse> => {
  const { context: loggedIn, team } = await requireTeamAdmin(db, context, teamId);
  const memberships = await db
    .select({ membership: teamMembers, displayName: users.displayName })
    .from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.userId))
    .where(and(eq(teamMembers.teamId, team.id), ne(teamMembers.status, TeamMemberStatus.REMOVED)))
    .orderBy(asc(teamMembers.requestedAt), asc(teamMembers.id));
  const { yearMonth, rows } = await loadRosterRowsForLinking(db, team.id);
  const linked = await listActiveLinkedKeys(db, team.id);
  const sorted = [
    ...memberships.filter((item) => item.membership.status === TeamMemberStatus.PENDING),
    ...memberships.filter((item) => item.membership.status === TeamMemberStatus.ACTIVE),
  ];

  return {
    members: sorted.map((item) => toTeamMemberDto(item.membership, item.displayName, rows, loggedIn.user.id)),
    rosterYearMonth: yearMonth,
    availableRows: rows.filter((row) => !linked.has(row.rowKey)),
  };
};

/** GET /api/invites/:token/rows (logged in): rows no active member is linked to. */
export const listJoinableRows = async (
  db: DbExecutor,
  context: RequestContext,
  token: string,
): Promise<InviteRowsResponse> => {
  requireUser(context);

  // Removed (rejected, left, removed) people may ask again (TeamShareSpec §15.2), so they get the same picker
  // as any logged-in visitor of a valid link: names, ordinals and the first 3 codes of unlinked rows only.
  const { team } = await findValidInvite(db, token);
  const { yearMonth, rows } = await loadRosterRowsForLinking(db, team.id);
  const linked = await listActiveLinkedKeys(db, team.id);

  return { yearMonth, rows: rows.filter((row) => !linked.has(row.rowKey)) };
};
