import 'server-only';

import { eq } from 'drizzle-orm';

import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { TeamMembershipConflictReason } from '@/domain/enums/TeamMembershipConflictReason';
import { TeamMemberStatus } from '@/domain/enums/TeamMemberStatus';
import { TeamRole } from '@/domain/enums/TeamRole';
import { type JoinTeamRequest } from '@/domain/types/api/JoinTeamRequest';
import { type TeamMembershipSummary } from '@/domain/types/api/TeamMembershipSummary';
import { type Db } from '@/server/db/Database';
import { teamMembers, teams } from '@/server/db/Schema';
import { ApiError } from '@/server/errors/ApiError';
import { type RequestContext } from '@/server/http/RequestContext';
import { findMembership, throwMembershipConflict } from '@/server/services/TeamAccess';
import { consumeInviteUse, findValidInvite, INVITE_GONE_MESSAGE } from '@/server/services/TeamInviteService';
import { assertLinkableRow } from '@/server/services/TeamMemberQueries';
import { requireUser } from '@/server/validation/RequestGuards';

/**
 * POST /api/invites/:token/join: PENDING request for a row (admin approval required). Active members,
 * duplicate requests and rows linked to an active member are refused (409); a REMOVED membership asks again.
 */
export const requestToJoin = async (
  db: Db,
  context: RequestContext,
  token: string,
  body: JoinTeamRequest,
): Promise<TeamMembershipSummary> => {
  const { user } = requireUser(context);
  const { invite, team } = await findValidInvite(db, token);

  return db.transaction(async (tx) => {
    await tx.select({ id: teams.id }).from(teams).where(eq(teams.id, team.id)).for('update');

    const existing = await findMembership(tx, team.id, user.id);

    if (existing?.status === TeamMemberStatus.ACTIVE) {
      throwMembershipConflict(TeamMembershipConflictReason.ALREADY_MEMBER);
    }

    if (existing?.status === TeamMemberStatus.PENDING) {
      throwMembershipConflict(TeamMembershipConflictReason.ALREADY_REQUESTED);
    }

    if (body.rowKey !== null) {
      await assertLinkableRow(tx, team.id, body.rowKey);
    }

    if (!(await consumeInviteUse(tx, invite.id))) {
      throw new ApiError(ApiErrorCode.NOT_FOUND, { message: INVITE_GONE_MESSAGE });
    }

    const values = {
      role: TeamRole.MEMBER,
      status: TeamMemberStatus.PENDING,
      linkedRowKey: body.rowKey,
      requestedAt: new Date(),
      approvedBy: null,
      approvedAt: null,
    };

    if (existing) {
      await tx.update(teamMembers).set(values).where(eq(teamMembers.id, existing.id));
    } else {
      await tx.insert(teamMembers).values({ teamId: team.id, userId: user.id, ...values });
    }

    return {
      teamId: team.id,
      teamName: team.name,
      role: values.role,
      status: values.status,
      linkedRowKey: body.rowKey,
    };
  });
};
