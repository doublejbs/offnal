import 'server-only';

import { and, eq } from 'drizzle-orm';

import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { RevisionConflictReason } from '@/domain/enums/RevisionConflictReason';
import { RosterRowExtractStatus } from '@/domain/enums/RosterRowExtractStatus';
import { TeamRosterStatus } from '@/domain/enums/TeamRosterStatus';
import { diffRosterRows } from '@/domain/TeamRosterDiff';
import { type PreviousRowRef } from '@/domain/types/api/PreviousRowRef';
import { type PublishTeamRosterRequest } from '@/domain/types/api/PublishTeamRosterRequest';
import { type PublishTeamRosterResponse } from '@/domain/types/api/PublishTeamRosterResponse';
import { type TeamRosterConflictDetails } from '@/domain/types/api/TeamRosterConflictDetails';
import { type Db, type DbTransaction } from '@/server/db/Database';
import {
  type TeamRosterRow,
  type TeamRosterRowRow,
  teamRosterChanges,
  teamRosters,
} from '@/server/db/Schema';
import { ApiError } from '@/server/errors/ApiError';
import { type RequestContext } from '@/server/http/RequestContext';
import { deleteJobSourceBestEffort } from '@/server/services/PublishService';
import { assertTeamPlanActive, lockTeamAsAdmin, requireTeamAdmin } from '@/server/services/TeamAccess';
import { listActiveLinkedKeys } from '@/server/services/TeamMemberQueries';
import { classifyRow } from '@/server/services/TeamRosterProgressBuilder';
import { listRowBlockers, requireTeamRoster, toDiffRows } from '@/server/services/TeamRosterQueries';
import { findPublishedRoster, listRosterRows } from '@/server/services/TeamRosterRows';
import { findLatestRevision } from '@/server/services/TeamRosterUploadService';

const UNLINKED_MESSAGE =
  '연결된 팀원의 행이 새 근무표에 없어요. “이름 바뀜”으로 이어 주거나, 그대로 배포하려면 한 번 더 확인해 주세요.';
const NOTHING_TO_PUBLISH_MESSAGE = '배포할 사람이 없어요. 제외하지 않은 행이 하나 이상 있어야 해요.';
const STILL_READING_MESSAGE = '아직 읽는 중인 사람이 있어요. 모두 읽은 뒤 배포해 주세요.';

type PublishOutcome = PublishTeamRosterResponse & { sourceJobId: string | null };

const throwConflict = (details: TeamRosterConflictDetails): never => {
  throw new ApiError(ApiErrorCode.REVISION_CONFLICT, { details });
};

export const lockRoster = async (
  tx: DbTransaction,
  teamId: string,
  rosterId: string,
): Promise<TeamRosterRow> => {
  const [roster] = await tx
    .select()
    .from(teamRosters)
    .where(and(eq(teamRosters.id, rosterId), eq(teamRosters.teamId, teamId)))
    .for('update');

  if (!roster) {
    throw new ApiError(ApiErrorCode.NOT_FOUND);
  }

  return roster;
};

/**
 * Makes `roster` the published revision of its month: archives the previous one and records every changed
 * cell (row-key matching) for the members' "변경" marks. The caller holds the team lock.
 */
export const promote = async (
  tx: DbTransaction,
  roster: TeamRosterRow,
  yearMonth: string,
  rows: TeamRosterRowRow[],
): Promise<{ revision: number; changedCellCount: number }> => {
  const previous = await findPublishedRoster(tx, roster.teamId, yearMonth);
  const revision = (await findLatestRevision(tx, roster.teamId, yearMonth)) + 1;
  const changes = previous
    ? diffRosterRows(toDiffRows(await listRosterRows(tx, previous.id)), toDiffRows(rows))
    : [];

  if (previous) {
    await tx
      .update(teamRosters)
      .set({ status: TeamRosterStatus.ARCHIVED })
      .where(eq(teamRosters.id, previous.id));
  }

  await tx
    .update(teamRosters)
    .set({
      status: TeamRosterStatus.PUBLISHED,
      revision,
      publishedAt: new Date(),
      version: roster.version + 1,
    })
    .where(eq(teamRosters.id, roster.id));

  if (changes.length > 0) {
    await tx.insert(teamRosterChanges).values(changes.map((change) => ({ rosterId: roster.id, ...change })));
  }

  return { revision, changedCellCount: changes.length };
};

/**
 * Linked members whose row of the current revision has no included row in the new one: publishing would
 * remove their month (Team spec §10: linked members are kept by row_key). Needs `confirmUnlinked`.
 */
const findDroppedLinkedRows = async (
  tx: DbTransaction,
  published: TeamRosterRow,
  rows: TeamRosterRowRow[],
): Promise<PreviousRowRef[]> => {
  const linked = await listActiveLinkedKeys(tx, published.teamId);
  const included = new Set(rows.filter((row) => !row.excluded).map((row) => row.rowKey));

  return (await listRosterRows(tx, published.id))
    .filter((row) => !row.excluded && linked.has(row.rowKey) && !included.has(row.rowKey))
    .map((row) => ({ rowKey: row.rowKey, displayName: row.displayName, linked: true }));
};

const runPublish = async (
  db: Db,
  userId: string,
  teamId: string,
  rosterId: string,
  request: PublishTeamRosterRequest,
): Promise<PublishOutcome> =>
  db.transaction(async (tx) => {
    await lockTeamAsAdmin(tx, teamId, userId);

    const roster = await lockRoster(tx, teamId, rosterId);

    if (roster.status !== TeamRosterStatus.DRAFT) {
      if (roster.revision === null || !roster.yearMonth) {
        throw new ApiError(ApiErrorCode.ROSTER_NOT_EDITABLE);
      }

      // Repeating a publish (e.g. a retried request) succeeds without a new revision.
      return {
        rosterId: roster.id,
        yearMonth: roster.yearMonth,
        revision: roster.revision,
        changedCellCount: 0,
        alreadyPublished: true,
        sourceJobId: null,
      };
    }

    if (roster.version !== request.version) {
      throwConflict({ reason: RevisionConflictReason.STALE_REVISION, currentVersion: roster.version });
    }

    if (!roster.rowsCreatedAt || !roster.yearMonth) {
      throw new ApiError(ApiErrorCode.ROSTER_NOT_EDITABLE, { message: STILL_READING_MESSAGE });
    }

    const published = await findPublishedRoster(tx, teamId, roster.yearMonth);
    const publishedRevision = published?.revision ?? 0;

    if (publishedRevision > roster.baseRevision) {
      throwConflict({
        reason: RevisionConflictReason.STALE_BASE,
        currentVersion: roster.version,
        publishedRevision,
      });
    }

    const rows = await listRosterRows(tx, roster.id);
    const now = new Date();

    if (
      rows.some(
        (row) =>
          !row.excluded &&
          [RosterRowExtractStatus.PENDING, RosterRowExtractStatus.PROCESSING].includes(classifyRow(row, now)),
      )
    ) {
      throw new ApiError(ApiErrorCode.ROSTER_NOT_EDITABLE, { message: STILL_READING_MESSAGE });
    }

    const blockers = listRowBlockers(rows, roster.definitions);

    if (blockers.length > 0) {
      throw new ApiError(ApiErrorCode.PUBLISH_BLOCKED, { details: { blockers } });
    }

    if (!rows.some((row) => !row.excluded)) {
      throw new ApiError(ApiErrorCode.PUBLISH_BLOCKED, {
        message: NOTHING_TO_PUBLISH_MESSAGE,
        details: { blockers: [] },
      });
    }

    const unlinkedRows = published ? await findDroppedLinkedRows(tx, published, rows) : [];

    if (unlinkedRows.length > 0 && !request.confirmUnlinked) {
      throw new ApiError(ApiErrorCode.PUBLISH_BLOCKED, {
        message: UNLINKED_MESSAGE,
        details: { blockers: [], unlinkedRows },
      });
    }

    const promoted = await promote(tx, roster, roster.yearMonth, rows);

    return {
      rosterId: roster.id,
      yearMonth: roster.yearMonth,
      ...promoted,
      alreadyPublished: false,
      sourceJobId: roster.sourceJobId,
    };
  });

/**
 * POST /api/teams/:id/rosters/:rid/publish (ADMIN): 422 while any included row needs review, 409 on a stale
 * version or when a newer revision was published after this draft was made. Members see it at once (their
 * calendars read the latest published revision). The photo is deleted after commit.
 */
export const publishTeamRoster = async (
  db: Db,
  context: RequestContext,
  teamId: string,
  rosterId: string,
  request: PublishTeamRosterRequest,
): Promise<PublishTeamRosterResponse> => {
  const { context: loggedIn, team } = await requireTeamAdmin(db, context, teamId);

  await requireTeamRoster(db, team.id, rosterId);
  await assertTeamPlanActive(db, team.id);

  const { sourceJobId, ...response } = await runPublish(db, loggedIn.user.id, team.id, rosterId, request);

  if (sourceJobId) {
    await deleteJobSourceBestEffort(db, sourceJobId);
  }

  return response;
};
