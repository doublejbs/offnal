import 'server-only';

import { and, eq } from 'drizzle-orm';

import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { TeamMembershipConflictReason } from '@/domain/enums/TeamMembershipConflictReason';
import { TeamMemberStatus } from '@/domain/enums/TeamMemberStatus';
import { TeamRole } from '@/domain/enums/TeamRole';
import { type TeamMembershipConflictDetails } from '@/domain/types/api/TeamMembershipConflictDetails';
import { type DbExecutor, type DbTransaction } from '@/server/db/Database';
import { type TeamMemberRow, teamMembers, type TeamRow, teams } from '@/server/db/Schema';
import { ApiError } from '@/server/errors/ApiError';
import { type LoggedInContext, type RequestContext } from '@/server/http/RequestContext';
import { requireUser, requireUuid } from '@/server/validation/RequestGuards';

/** The viewer's active membership of a team (admins are active members with the ADMIN role). */
export type TeamAccess = {
  context: LoggedInContext;
  team: TeamRow;
  membership: TeamMemberRow;
};

export const MEMBERSHIP_CONFLICT_MESSAGES: Record<TeamMembershipConflictReason, string> = {
  [TeamMembershipConflictReason.ALREADY_MEMBER]: '이미 이 팀의 팀원이에요.',
  [TeamMembershipConflictReason.ALREADY_REQUESTED]:
    '이미 참여를 요청했어요. 관리자가 승인하면 달력에 나타나요.',
  [TeamMembershipConflictReason.ROW_TAKEN]: '이미 다른 팀원과 연결된 이름이에요.',
  [TeamMembershipConflictReason.LAST_ADMIN]:
    '팀에는 관리자가 한 명 이상 있어야 해요. 다른 관리자를 먼저 지정해 주세요.',
  [TeamMembershipConflictReason.INVALID_STATE]: '지금 상태에서는 할 수 없는 요청이에요.',
};

export const throwMembershipConflict = (reason: TeamMembershipConflictReason): never => {
  const details: TeamMembershipConflictDetails = { reason };

  throw new ApiError(ApiErrorCode.TEAM_MEMBERSHIP_CONFLICT, {
    message: MEMBERSHIP_CONFLICT_MESSAGES[reason],
    details,
  });
};

const throwTeamNotFound = (): never => {
  throw new ApiError(ApiErrorCode.NOT_FOUND);
};

export const findMembership = async (
  db: DbExecutor,
  teamId: string,
  userId: string,
): Promise<TeamMemberRow | null> => {
  const [membership] = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))
    .limit(1);

  return membership ?? null;
};

/**
 * ACTIVE members (and admins) only. Non-members, PENDING requests, REMOVED members and unknown teams all
 * get the same 404 so a team's existence is never revealed. Not logged in → 401.
 */
export const requireActiveMember = async (
  db: DbExecutor,
  context: RequestContext,
  teamId: string,
): Promise<TeamAccess> => {
  const loggedIn = requireUser(context);
  const [row] = await db
    .select({ team: teams, membership: teamMembers })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .where(
      and(
        eq(teamMembers.teamId, requireUuid(teamId)),
        eq(teamMembers.userId, loggedIn.user.id),
        eq(teamMembers.status, TeamMemberStatus.ACTIVE),
      ),
    )
    .limit(1);

  if (!row) {
    return throwTeamNotFound();
  }

  return { context: loggedIn, team: row.team, membership: row.membership };
};

export const isTeamAdmin = (membership: TeamMemberRow): boolean =>
  membership.status === TeamMemberStatus.ACTIVE && membership.role === TeamRole.ADMIN;

/** ADMIN only; everyone else (members included) gets 404. */
export const requireTeamAdmin = async (
  db: DbExecutor,
  context: RequestContext,
  teamId: string,
): Promise<TeamAccess> => {
  const access = await requireActiveMember(db, context, teamId);

  if (!isTeamAdmin(access.membership)) {
    return throwTeamNotFound();
  }

  return access;
};

/**
 * Serializes membership/publish changes of one team (last-admin protection, one publish at a time) and
 * re-checks that the caller is still an admin inside the transaction.
 */
export const lockTeamAsAdmin = async (
  tx: DbTransaction,
  teamId: string,
  userId: string,
): Promise<TeamRow> => {
  const [team] = await tx.select().from(teams).where(eq(teams.id, teamId)).for('update');
  const membership = team ? await findMembership(tx, teamId, userId) : null;

  if (!team || !membership || !isTeamAdmin(membership)) {
    return throwTeamNotFound();
  }

  return team;
};

/**
 * Team plan check point (Team spec §9·§12-1). T1 is a free beta, so every team may upload, edit and publish.
 * Later this reads `team_subscriptions`; it must stay server-side (never a client flag).
 */
export const assertTeamPlanActive = async (_db: DbExecutor, _teamId: string): Promise<void> => {
  // Beta: always allowed.
};
