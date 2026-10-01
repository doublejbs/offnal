import 'server-only';

import { and, asc, count, eq, inArray, isNotNull, ne } from 'drizzle-orm';

import { RecognitionStatus } from '@/domain/enums/RecognitionStatus';
import { TeamMemberStatus } from '@/domain/enums/TeamMemberStatus';
import { TeamRole } from '@/domain/enums/TeamRole';
import { type CreateTeamRequest } from '@/domain/types/api/CreateTeamRequest';
import { type OkResponse } from '@/domain/types/api/OkResponse';
import { type TeamDetailResponse } from '@/domain/types/api/TeamDetailResponse';
import { type TeamDto } from '@/domain/types/api/TeamDto';
import { type TeamListResponse } from '@/domain/types/api/TeamListResponse';
import { type UpdateTeamRequest } from '@/domain/types/api/UpdateTeamRequest';
import { type Db, type DbExecutor } from '@/server/db/Database';
import { recognitionJobs, teamMembers, teamRosters, type TeamRow, teams } from '@/server/db/Schema';
import { type RequestContext } from '@/server/http/RequestContext';
import { deleteJobSourceBestEffort } from '@/server/services/PublishService';
import {
  isTeamAdmin,
  lockTeamAsAdmin,
  requireActiveMember,
  requireTeamAdmin,
  type TeamAccess,
} from '@/server/services/TeamAccess';
import { listPublishedRosters } from '@/server/services/TeamRosterRows';
import { requireUser } from '@/server/validation/RequestGuards';

export const toTeamDto = (team: TeamRow): TeamDto => ({
  id: team.id,
  name: team.name,
  shareRosterWithMembers: team.shareRosterWithMembers,
  createdAt: team.createdAt.toISOString(),
});

const countPendingRequests = async (db: DbExecutor, teamId: string): Promise<number> => {
  const [row] = await db
    .select({ value: count() })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.status, TeamMemberStatus.PENDING)));

  return row?.value ?? 0;
};

const buildTeamDetail = async (db: DbExecutor, access: TeamAccess): Promise<TeamDetailResponse> => {
  const isAdmin = isTeamAdmin(access.membership);
  const published = await listPublishedRosters(db, access.team.id);

  return {
    team: toTeamDto(access.team),
    myRole: access.membership.role,
    myStatus: access.membership.status,
    myLinkedRowKey: access.membership.linkedRowKey,
    publishedMonths: published.flatMap((roster) =>
      roster.yearMonth && roster.revision !== null && roster.publishedAt
        ? [
            {
              yearMonth: roster.yearMonth,
              revision: roster.revision,
              publishedAt: roster.publishedAt.toISOString(),
              rosterId: isAdmin ? roster.id : null,
            },
          ]
        : [],
    ),
    pendingRequestCount: isAdmin ? await countPendingRequests(db, access.team.id) : 0,
  };
};

/** POST /api/teams: the creator becomes the first (active) admin. */
export const createTeam = async (
  db: Db,
  context: RequestContext,
  body: CreateTeamRequest,
): Promise<TeamDetailResponse> => {
  const loggedIn = requireUser(context);
  const { user } = loggedIn;
  const teamId = await db.transaction(async (tx) => {
    const [team] = await tx.insert(teams).values({ name: body.name, createdBy: user.id }).returning();

    if (!team) {
      throw new Error('Team insert returned no row');
    }

    await tx.insert(teamMembers).values({
      teamId: team.id,
      userId: user.id,
      role: TeamRole.ADMIN,
      status: TeamMemberStatus.ACTIVE,
      approvedBy: user.id,
      approvedAt: new Date(),
    });

    return team.id;
  });

  return getTeamDetail(db, loggedIn, teamId);
};

/** GET /api/teams: PENDING and ACTIVE memberships of the viewer, oldest team first. */
export const listMyTeams = async (db: DbExecutor, context: RequestContext): Promise<TeamListResponse> => {
  const { user } = requireUser(context);
  const rows = await db
    .select({ team: teams, membership: teamMembers })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .where(and(eq(teamMembers.userId, user.id), ne(teamMembers.status, TeamMemberStatus.REMOVED)))
    .orderBy(asc(teams.createdAt), asc(teams.id));

  return {
    teams: rows.map(({ team, membership }) => ({
      teamId: team.id,
      teamName: team.name,
      role: membership.role,
      status: membership.status,
      linkedRowKey: membership.linkedRowKey,
    })),
  };
};

export const getTeamDetail = async (
  db: DbExecutor,
  context: RequestContext,
  teamId: string,
): Promise<TeamDetailResponse> => buildTeamDetail(db, await requireActiveMember(db, context, teamId));

/** PATCH /api/teams/:id (ADMIN). Turning `shareRosterWithMembers` off hides the full roster from members at once. */
export const updateTeam = async (
  db: DbExecutor,
  context: RequestContext,
  teamId: string,
  body: UpdateTeamRequest,
): Promise<TeamDetailResponse> => {
  const access = await requireTeamAdmin(db, context, teamId);
  const [updated] = await db
    .update(teams)
    .set({
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.shareRosterWithMembers !== undefined
        ? { shareRosterWithMembers: body.shareRosterWithMembers }
        : {}),
    })
    .where(eq(teams.id, access.team.id))
    .returning();

  return buildTeamDetail(db, { ...access, team: updated ?? access.team });
};

/**
 * DELETE /api/teams/:id (ADMIN): rosters, rows, changes, invites, memberships, acks and share flags go with the
 * team (FK cascade); users stay. Upload jobs (everyone's names in the first-pass table) are expired right away
 * and their photos deleted (best effort; the cleanup cron retries).
 */
export const deleteTeam = async (db: Db, context: RequestContext, teamId: string): Promise<OkResponse> => {
  const { context: loggedIn, team } = await requireTeamAdmin(db, context, teamId);
  const jobIds = await db.transaction(async (tx) => {
    await lockTeamAsAdmin(tx, team.id, loggedIn.user.id);

    const jobs = await tx
      .select({ id: teamRosters.sourceJobId })
      .from(teamRosters)
      .where(and(eq(teamRosters.teamId, team.id), isNotNull(teamRosters.sourceJobId)));
    const ids = jobs.flatMap((job) => (job.id ? [job.id] : []));

    if (ids.length > 0) {
      await tx
        .update(recognitionJobs)
        .set({
          status: RecognitionStatus.EXPIRED,
          tableResult: null,
          leaseExpiresAt: null,
          expiresAt: new Date(),
        })
        .where(inArray(recognitionJobs.id, ids));
    }

    await tx.delete(teams).where(eq(teams.id, team.id));

    return ids;
  });

  for (const jobId of jobIds) {
    await deleteJobSourceBestEffort(db, jobId);
  }

  return { ok: true };
};
