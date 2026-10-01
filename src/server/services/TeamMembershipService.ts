import 'server-only';

import { and, eq } from 'drizzle-orm';

import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { TeamMembershipConflictReason } from '@/domain/enums/TeamMembershipConflictReason';
import { TeamMemberStatus } from '@/domain/enums/TeamMemberStatus';
import { TeamRole } from '@/domain/enums/TeamRole';
import { type ApproveTeamMemberRequest } from '@/domain/types/api/ApproveTeamMemberRequest';
import { type OkResponse } from '@/domain/types/api/OkResponse';
import { type TeamMemberDto } from '@/domain/types/api/TeamMemberDto';
import { type UpdateTeamMemberRequest } from '@/domain/types/api/UpdateTeamMemberRequest';
import { type Db, type DbTransaction } from '@/server/db/Database';
import { isUniqueViolation } from '@/server/db/DbErrors';
import {
  memberChangeAcks,
  memberSharedTeamMonths,
  type TeamMemberRow,
  teamMembers,
  teams,
} from '@/server/db/Schema';
import { ApiError } from '@/server/errors/ApiError';
import { type RequestContext } from '@/server/http/RequestContext';
import {
  findMembership,
  lockTeamAsAdmin,
  requireTeamAdmin,
  throwMembershipConflict,
} from '@/server/services/TeamAccess';
import { assertLinkableRow, assertNotLastAdmin, loadMemberDto } from '@/server/services/TeamMemberQueries';
import { listPublishedRosters } from '@/server/services/TeamRosterRows';
import { requireUser, requireUuid } from '@/server/validation/RequestGuards';

const requireTargetMembership = async (
  tx: DbTransaction,
  teamId: string,
  userId: string,
): Promise<TeamMemberRow> => {
  const membership = await findMembership(tx, teamId, requireUuid(userId));

  if (!membership || membership.status === TeamMemberStatus.REMOVED) {
    throw new ApiError(ApiErrorCode.NOT_FOUND);
  }

  return membership;
};

/** The unique index (one active member per row) is the final guard against concurrent approvals. */
const withRowTakenGuard = async <T>(operation: () => Promise<T>): Promise<T> => {
  try {
    return await operation();
  } catch (error: unknown) {
    if (isUniqueViolation(error)) {
      return throwMembershipConflict(TeamMembershipConflictReason.ROW_TAKEN);
    }

    throw error;
  }
};

/** Access ends at once: the member's team months leave their calendar and share link immediately. */
const markRemoved = async (tx: DbTransaction, membership: TeamMemberRow): Promise<void> => {
  await tx
    .update(teamMembers)
    .set({ status: TeamMemberStatus.REMOVED, role: TeamRole.MEMBER, linkedRowKey: null })
    .where(eq(teamMembers.id, membership.id));
  await tx
    .delete(memberSharedTeamMonths)
    .where(
      and(
        eq(memberSharedTeamMonths.teamId, membership.teamId),
        eq(memberSharedTeamMonths.userId, membership.userId),
      ),
    );
  await tx
    .delete(memberChangeAcks)
    .where(
      and(eq(memberChangeAcks.teamId, membership.teamId), eq(memberChangeAcks.userId, membership.userId)),
    );
};

/** "변경" marks start after approval: every month published so far counts as seen. */
const acknowledgePublishedMonths = async (
  tx: DbTransaction,
  teamId: string,
  userId: string,
): Promise<void> => {
  for (const roster of await listPublishedRosters(tx, teamId)) {
    if (!roster.yearMonth || roster.revision === null) {
      continue;
    }

    await tx
      .insert(memberChangeAcks)
      .values({ teamId, userId, yearMonth: roster.yearMonth, ackedRevision: roster.revision })
      .onConflictDoUpdate({
        target: [memberChangeAcks.teamId, memberChangeAcks.userId, memberChangeAcks.yearMonth],
        set: { ackedRevision: roster.revision },
      });
  }
};

/** POST .../members/:userId/approve (ADMIN): PENDING → ACTIVE with the requested or a corrected row. */
export const approveMember = async (
  db: Db,
  context: RequestContext,
  teamId: string,
  userId: string,
  body: ApproveTeamMemberRequest,
): Promise<TeamMemberDto> => {
  const { context: loggedIn, team } = await requireTeamAdmin(db, context, teamId);

  await db.transaction(async (tx) => {
    await lockTeamAsAdmin(tx, team.id, loggedIn.user.id);

    const target = await requireTargetMembership(tx, team.id, userId);

    if (target.status !== TeamMemberStatus.PENDING) {
      throwMembershipConflict(TeamMembershipConflictReason.INVALID_STATE);
    }

    const rowKey = body.rowKey === undefined ? target.linkedRowKey : body.rowKey;

    if (rowKey !== null) {
      await assertLinkableRow(tx, team.id, rowKey, target.userId);
    }

    await withRowTakenGuard(() =>
      tx
        .update(teamMembers)
        .set({
          status: TeamMemberStatus.ACTIVE,
          linkedRowKey: rowKey,
          approvedBy: loggedIn.user.id,
          approvedAt: new Date(),
        })
        .where(eq(teamMembers.id, target.id)),
    );
    await acknowledgePublishedMonths(tx, team.id, target.userId);
  });

  return loadMemberDto(db, team.id, userId, loggedIn.user.id);
};

/** POST .../members/:userId/reject (ADMIN): the request is dropped (REMOVED); the person may ask again. */
export const rejectMember = async (
  db: Db,
  context: RequestContext,
  teamId: string,
  userId: string,
): Promise<OkResponse> => {
  const { context: loggedIn, team } = await requireTeamAdmin(db, context, teamId);

  await db.transaction(async (tx) => {
    await lockTeamAsAdmin(tx, team.id, loggedIn.user.id);

    const target = await requireTargetMembership(tx, team.id, userId);

    if (target.status !== TeamMemberStatus.PENDING) {
      throwMembershipConflict(TeamMembershipConflictReason.INVALID_STATE);
    }

    await markRemoved(tx, target);
  });

  return { ok: true };
};

/** DELETE .../members/:userId (ADMIN): removes a member or request. The last admin cannot be removed. */
export const removeMember = async (
  db: Db,
  context: RequestContext,
  teamId: string,
  userId: string,
): Promise<OkResponse> => {
  const { context: loggedIn, team } = await requireTeamAdmin(db, context, teamId);

  await db.transaction(async (tx) => {
    await lockTeamAsAdmin(tx, team.id, loggedIn.user.id);

    const target = await requireTargetMembership(tx, team.id, userId);

    await assertNotLastAdmin(tx, target);
    await markRemoved(tx, target);
  });

  return { ok: true };
};

/** PATCH .../members/:userId (ADMIN): change an active member's linked row and/or role. */
export const updateMember = async (
  db: Db,
  context: RequestContext,
  teamId: string,
  userId: string,
  body: UpdateTeamMemberRequest,
): Promise<TeamMemberDto> => {
  const { context: loggedIn, team } = await requireTeamAdmin(db, context, teamId);

  await db.transaction(async (tx) => {
    await lockTeamAsAdmin(tx, team.id, loggedIn.user.id);

    const target = await requireTargetMembership(tx, team.id, userId);

    if (target.status !== TeamMemberStatus.ACTIVE) {
      throwMembershipConflict(TeamMembershipConflictReason.INVALID_STATE);
    }

    if (body.role === TeamRole.MEMBER) {
      await assertNotLastAdmin(tx, target);
    }

    if (body.rowKey) {
      await assertLinkableRow(tx, team.id, body.rowKey, target.userId);
    }

    await withRowTakenGuard(() =>
      tx
        .update(teamMembers)
        .set({
          ...(body.role !== undefined ? { role: body.role } : {}),
          ...(body.rowKey !== undefined ? { linkedRowKey: body.rowKey } : {}),
        })
        .where(eq(teamMembers.id, target.id)),
    );
  });

  return loadMemberDto(db, team.id, userId, loggedIn.user.id);
};

/** DELETE /api/teams/:id/membership: leave (or withdraw a request). The last admin must hand over first. */
export const leaveTeam = async (db: Db, context: RequestContext, teamId: string): Promise<OkResponse> => {
  const { user } = requireUser(context);
  const id = requireUuid(teamId);

  await db.transaction(async (tx) => {
    await tx.select({ id: teams.id }).from(teams).where(eq(teams.id, id)).for('update');

    const membership = await findMembership(tx, id, user.id);

    if (!membership || membership.status === TeamMemberStatus.REMOVED) {
      throw new ApiError(ApiErrorCode.NOT_FOUND);
    }

    await assertNotLastAdmin(tx, membership);
    await markRemoved(tx, membership);
  });

  return { ok: true };
};
