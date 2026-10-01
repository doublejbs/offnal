import 'server-only';

import { and, eq, isNull } from 'drizzle-orm';

import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { TeamRosterStatus } from '@/domain/enums/TeamRosterStatus';
import { type CreateRosterDraftResponse } from '@/domain/types/api/CreateRosterDraftResponse';
import { type PublishTeamRosterResponse } from '@/domain/types/api/PublishTeamRosterResponse';
import { type RevertTeamRosterRequest } from '@/domain/types/api/RevertTeamRosterRequest';
import { type Db, type DbTransaction } from '@/server/db/Database';
import { type TeamRosterRowRow, teamRosterRows, teamRosters } from '@/server/db/Schema';
import { ApiError } from '@/server/errors/ApiError';
import { type RequestContext } from '@/server/http/RequestContext';
import { assertTeamPlanActive, lockTeamAsAdmin, requireTeamAdmin } from '@/server/services/TeamAccess';
import { requireTeamRoster } from '@/server/services/TeamRosterQueries';
import { assertKeepsLinkedRows, lockRoster, promote } from '@/server/services/TeamRosterPublishService';
import { findLatestRevision, findPublishedRoster, listRosterRows } from '@/server/services/TeamRosterRows';

const ALREADY_CURRENT_MESSAGE = '지금 배포 중인 버전이에요.';

/** Copies rows (with their state) into another roster. */
const copyRows = async (tx: DbTransaction, rows: TeamRosterRowRow[], rosterId: string): Promise<void> => {
  if (rows.length === 0) {
    return;
  }

  await tx.insert(teamRosterRows).values(
    rows.map(({ id: _id, rosterId: _rosterId, updatedAt: _updatedAt, leaseExpiresAt: _lease, ...row }) => ({
      ...row,
      rosterId,
    })),
  );
};

/** POST .../rosters/:rid/revert (ADMIN): republishes an older revision's content as a new revision. */
export const revertTeamRoster = async (
  db: Db,
  context: RequestContext,
  teamId: string,
  rosterId: string,
  request: RevertTeamRosterRequest,
): Promise<PublishTeamRosterResponse> => {
  const { context: loggedIn, team } = await requireTeamAdmin(db, context, teamId);

  await requireTeamRoster(db, team.id, rosterId);
  await assertTeamPlanActive(db, team.id);

  return db.transaction(async (tx) => {
    await lockTeamAsAdmin(tx, team.id, loggedIn.user.id);

    const source = await lockRoster(tx, team.id, rosterId);

    if (source.status === TeamRosterStatus.PUBLISHED) {
      throw new ApiError(ApiErrorCode.ROSTER_NOT_EDITABLE, { message: ALREADY_CURRENT_MESSAGE });
    }

    if (source.status !== TeamRosterStatus.ARCHIVED || !source.yearMonth) {
      throw new ApiError(ApiErrorCode.ROSTER_NOT_EDITABLE);
    }

    const sourceRows = await listRosterRows(tx, source.id);

    // Same protection as publish: reverting must not silently drop linked members.
    await assertKeepsLinkedRows(
      tx,
      await findPublishedRoster(tx, team.id, source.yearMonth),
      sourceRows,
      request.confirmUnlinked === true,
    );

    const [copy] = await tx
      .insert(teamRosters)
      .values({
        teamId: team.id,
        yearMonth: source.yearMonth,
        status: TeamRosterStatus.DRAFT,
        baseRevision: await findLatestRevision(tx, team.id, source.yearMonth),
        definitions: source.definitions,
        rowsCreatedAt: new Date(),
        createdBy: loggedIn.user.id,
      })
      .returning();

    if (!copy) {
      throw new Error('Roster copy returned no row');
    }

    await copyRows(tx, sourceRows, copy.id);

    const promoted = await promote(tx, copy, source.yearMonth, await listRosterRows(tx, copy.id));

    return { rosterId: copy.id, yearMonth: source.yearMonth, ...promoted, alreadyPublished: false };
  });
};

/**
 * POST .../rosters/:rid/draft (ADMIN): DRAFT copy of the published revision for direct edits. An open copy of
 * the same revision (no photo) is reused.
 */
export const createRosterDraft = async (
  db: Db,
  context: RequestContext,
  teamId: string,
  rosterId: string,
): Promise<CreateRosterDraftResponse> => {
  const { context: loggedIn, team } = await requireTeamAdmin(db, context, teamId);

  await requireTeamRoster(db, team.id, rosterId);
  await assertTeamPlanActive(db, team.id);

  return db.transaction(async (tx) => {
    await lockTeamAsAdmin(tx, team.id, loggedIn.user.id);

    const source = await lockRoster(tx, team.id, rosterId);

    if (source.status !== TeamRosterStatus.PUBLISHED || source.revision === null || !source.yearMonth) {
      throw new ApiError(ApiErrorCode.ROSTER_NOT_EDITABLE, {
        message: '배포 중인 근무표에서만 새 초안을 만들 수 있어요.',
      });
    }

    const [open] = await tx
      .select({ id: teamRosters.id })
      .from(teamRosters)
      .where(
        and(
          eq(teamRosters.teamId, team.id),
          eq(teamRosters.yearMonth, source.yearMonth),
          eq(teamRosters.status, TeamRosterStatus.DRAFT),
          eq(teamRosters.baseRevision, source.revision),
          isNull(teamRosters.sourceJobId),
        ),
      )
      .limit(1);

    if (open) {
      return { rosterId: open.id };
    }

    const [copy] = await tx
      .insert(teamRosters)
      .values({
        teamId: team.id,
        yearMonth: source.yearMonth,
        status: TeamRosterStatus.DRAFT,
        baseRevision: source.revision,
        definitions: source.definitions,
        rowsCreatedAt: new Date(),
        createdBy: loggedIn.user.id,
      })
      .returning({ id: teamRosters.id });

    if (!copy) {
      throw new Error('Roster copy returned no row');
    }

    await copyRows(tx, await listRosterRows(tx, source.id), copy.id);

    return { rosterId: copy.id };
  });
};
