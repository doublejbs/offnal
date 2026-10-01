import 'server-only';

import { and, desc, eq, gt, isNull, lt, or, sql } from 'drizzle-orm';

import { MS_PER_DAY } from '@/domain/DomainLimits';
import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { TeamMemberStatus } from '@/domain/enums/TeamMemberStatus';
import { type CreateTeamInviteRequest } from '@/domain/types/api/CreateTeamInviteRequest';
import { type CreateTeamInviteResponse } from '@/domain/types/api/CreateTeamInviteResponse';
import { type InviteLookupResponse } from '@/domain/types/api/InviteLookupResponse';
import { type OkResponse } from '@/domain/types/api/OkResponse';
import { type TeamInviteDto } from '@/domain/types/api/TeamInviteDto';
import { type TeamInviteListResponse } from '@/domain/types/api/TeamInviteListResponse';
import { generateToken, hashSha256Hex } from '@/server/crypto/TokenCrypto';
import { type DbExecutor } from '@/server/db/Database';
import { type TeamInviteRow, teamInvites, type TeamRow, teams } from '@/server/db/Schema';
import { ApiError } from '@/server/errors/ApiError';
import { type RequestContext } from '@/server/http/RequestContext';
import { buildAppUrl } from '@/server/http/RouteHelpers';
import { findMembership, requireTeamAdmin } from '@/server/services/TeamAccess';
import { DEFAULT_INVITE_DAYS } from '@/server/services/TeamRequestSchemas';
import { requireUuid } from '@/server/validation/RequestGuards';

/** 32 random bytes in base64url (256 bits), like share tokens. */
const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

export const INVITE_GONE_MESSAGE = '초대 링크가 만료되었거나 중지되었어요. 관리자에게 새 링크를 받아 주세요.';

export type ValidInvite = {
  invite: TeamInviteRow;
  team: TeamRow;
};

const isInviteActive = (invite: TeamInviteRow, now: Date): boolean =>
  invite.revokedAt === null &&
  invite.expiresAt.getTime() > now.getTime() &&
  (invite.maxUses === null || invite.useCount < invite.maxUses);

const toInviteDto = (invite: TeamInviteRow, now = new Date()): TeamInviteDto => ({
  id: invite.id,
  createdAt: invite.createdAt.toISOString(),
  expiresAt: invite.expiresAt.toISOString(),
  revokedAt: invite.revokedAt?.toISOString() ?? null,
  maxUses: invite.maxUses,
  useCount: invite.useCount,
  active: isInviteActive(invite, now),
});

export const buildInviteUrl = (token: string): string => buildAppUrl(`/join/${token}`).toString();

const throwInviteGone = (): never => {
  throw new ApiError(ApiErrorCode.NOT_FOUND, { message: INVITE_GONE_MESSAGE });
};

/** POST /api/teams/:id/invites (ADMIN). The token is returned once; only its sha256 is stored. */
export const issueInvite = async (
  db: DbExecutor,
  context: RequestContext,
  teamId: string,
  body: CreateTeamInviteRequest,
): Promise<CreateTeamInviteResponse> => {
  const { context: loggedIn, team } = await requireTeamAdmin(db, context, teamId);
  const token = generateToken();
  const now = new Date();
  const [invite] = await db
    .insert(teamInvites)
    .values({
      teamId: team.id,
      tokenHash: hashSha256Hex(token),
      createdBy: loggedIn.user.id,
      createdAt: now,
      expiresAt: new Date(now.getTime() + (body.expiresInDays ?? DEFAULT_INVITE_DAYS) * MS_PER_DAY),
      maxUses: body.maxUses ?? null,
    })
    .returning();

  if (!invite) {
    throw new Error('Invite insert returned no row');
  }

  return { invite: toInviteDto(invite, now), token, url: buildInviteUrl(token) };
};

/** GET /api/teams/:id/invites (ADMIN), newest first. Tokens are never part of the list. */
export const listInvites = async (
  db: DbExecutor,
  context: RequestContext,
  teamId: string,
): Promise<TeamInviteListResponse> => {
  const { team } = await requireTeamAdmin(db, context, teamId);
  const rows = await db
    .select()
    .from(teamInvites)
    .where(eq(teamInvites.teamId, team.id))
    .orderBy(desc(teamInvites.createdAt));
  const now = new Date();

  return { invites: rows.map((invite) => toInviteDto(invite, now)) };
};

/** DELETE /api/teams/:id/invites/:inviteId (ADMIN): stops the link at once (idempotent). */
export const revokeInvite = async (
  db: DbExecutor,
  context: RequestContext,
  teamId: string,
  inviteId: string,
): Promise<OkResponse> => {
  const { team } = await requireTeamAdmin(db, context, teamId);
  const [invite] = await db
    .select()
    .from(teamInvites)
    .where(and(eq(teamInvites.id, requireUuid(inviteId)), eq(teamInvites.teamId, team.id)))
    .limit(1);

  if (!invite) {
    throw new ApiError(ApiErrorCode.NOT_FOUND);
  }

  if (!invite.revokedAt) {
    await db.update(teamInvites).set({ revokedAt: new Date() }).where(eq(teamInvites.id, invite.id));
  }

  return { ok: true };
};

/** Token → active invite and its team. Malformed, unknown, revoked, expired or used-up → the same 404. */
export const findValidInvite = async (
  db: DbExecutor,
  token: string,
  now = new Date(),
): Promise<ValidInvite> => {
  if (!INVITE_TOKEN_PATTERN.test(token)) {
    return throwInviteGone();
  }

  const [row] = await db
    .select({ invite: teamInvites, team: teams })
    .from(teamInvites)
    .innerJoin(teams, eq(teams.id, teamInvites.teamId))
    .where(eq(teamInvites.tokenHash, hashSha256Hex(token)))
    .limit(1);

  if (!row || !isInviteActive(row.invite, now)) {
    return throwInviteGone();
  }

  return row;
};

/** Counts one accepted join request; false when the link was used up (or stopped) concurrently. */
export const consumeInviteUse = async (
  db: DbExecutor,
  inviteId: string,
  now = new Date(),
): Promise<boolean> => {
  const [updated] = await db
    .update(teamInvites)
    .set({ useCount: sql`${teamInvites.useCount} + 1` })
    .where(
      and(
        eq(teamInvites.id, inviteId),
        isNull(teamInvites.revokedAt),
        gt(teamInvites.expiresAt, now),
        or(isNull(teamInvites.maxUses), lt(teamInvites.useCount, teamInvites.maxUses)),
      ),
    )
    .returning({ id: teamInvites.id });

  return updated !== undefined;
};

/**
 * GET /api/invites/:token (public). Before login exactly `{ teamName }`. Logged-in viewers also get their
 * PENDING/ACTIVE membership (or null) so the join page can show "요청 완료".
 */
export const lookupInvite = async (
  db: DbExecutor,
  context: RequestContext,
  token: string,
): Promise<InviteLookupResponse> => {
  const { team } = await findValidInvite(db, token);

  if (!context.user) {
    return { teamName: team.name };
  }

  const membership = await findMembership(db, team.id, context.user.id);

  return {
    teamName: team.name,
    membership:
      membership && membership.status !== TeamMemberStatus.REMOVED
        ? {
            teamId: team.id,
            teamName: team.name,
            role: membership.role,
            status: membership.status,
            linkedRowKey: membership.linkedRowKey,
          }
        : null,
  };
};
