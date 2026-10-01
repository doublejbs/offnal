import 'server-only';

import { and, desc, eq, isNotNull } from 'drizzle-orm';

import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { TeamMemberStatus } from '@/domain/enums/TeamMemberStatus';
import { TeamRosterPhase } from '@/domain/enums/TeamRosterPhase';
import { TeamRosterStatus } from '@/domain/enums/TeamRosterStatus';
import { getPublishBlockers } from '@/domain/ScheduleValidator';
import { type DiffRow, diffRosterRows, type RosterCellChange } from '@/domain/TeamRosterDiff';
import { computeSameNameLabels, matchRowKeys } from '@/domain/TeamRowKey';
import { type TeamRosterChangePreview } from '@/domain/types/api/TeamRosterChangePreview';
import { type TeamRosterConflictDetails } from '@/domain/types/api/TeamRosterConflictDetails';
import { type TeamRosterDto } from '@/domain/types/api/TeamRosterDto';
import { type TeamRosterListResponse } from '@/domain/types/api/TeamRosterListResponse';
import { type TeamRosterResponse } from '@/domain/types/api/TeamRosterResponse';
import { type TeamRosterRowBlocker } from '@/domain/types/api/TeamRosterRowBlocker';
import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';
import { type DbExecutor } from '@/server/db/Database';
import {
  type RecognitionJobRow,
  recognitionJobs,
  teamMembers,
  type TeamRosterRow,
  type TeamRosterRowRow,
  teamRosters,
  users,
} from '@/server/db/Schema';
import { ApiError, SOURCE_GONE_MESSAGE } from '@/server/errors/ApiError';
import { type RequestContext } from '@/server/http/RequestContext';
import { isSourceAvailable } from '@/server/services/RecognitionOwnership';
import { readSourceBytes } from '@/server/services/RecognitionProcessService';
import { requireTeamAdmin } from '@/server/services/TeamAccess';
import { buildRosterProgress } from '@/server/services/TeamRosterProgressBuilder';
import {
  findPublishedRoster,
  findRosterJob,
  listRosterRows,
  listRowsByRoster,
} from '@/server/services/TeamRosterRows';
import { requireUuid } from '@/server/validation/RequestGuards';

/** The one way roster PATCH/publish/revert report a 409 REVISION_CONFLICT. */
export const throwRosterConflict = (details: TeamRosterConflictDetails): never => {
  throw new ApiError(ApiErrorCode.REVISION_CONFLICT, { details });
};

/** A roster of this team, else 404 (rosters of other teams are never revealed). */
export const requireTeamRoster = async (
  db: DbExecutor,
  teamId: string,
  rosterId: string,
): Promise<TeamRosterRow> => {
  const [roster] = await db
    .select()
    .from(teamRosters)
    .where(and(eq(teamRosters.id, requireUuid(rosterId)), eq(teamRosters.teamId, teamId)))
    .limit(1);

  if (!roster) {
    throw new ApiError(ApiErrorCode.NOT_FOUND);
  }

  return roster;
};

const toRosterDto = (roster: TeamRosterRow, job: RecognitionJobRow | null): TeamRosterDto => ({
  id: roster.id,
  teamId: roster.teamId,
  yearMonth: roster.yearMonth,
  status: roster.status,
  revision: roster.revision,
  baseRevision: roster.baseRevision,
  version: roster.version,
  createdAt: roster.createdAt.toISOString(),
  publishedAt: roster.publishedAt?.toISOString() ?? null,
  authorityConfirmedAt: roster.authorityConfirmedAt?.toISOString() ?? null,
  sourceAvailable: isSourceAvailable(job),
});

/** Non-excluded rows that cannot be published yet with the roster's legend. */
export const listRowBlockers = (
  rows: TeamRosterRowRow[],
  definitions: ShiftDefinition[],
): TeamRosterRowBlocker[] =>
  rows.flatMap((row) => {
    const blockers = row.excluded ? [] : getPublishBlockers(row.entries, definitions);

    return blockers.length > 0
      ? [{ rowId: row.id, rowKey: row.rowKey, displayName: row.displayName, blockers }]
      : [];
  });

export const toDiffRows = (rows: TeamRosterRowRow[]): DiffRow[] =>
  rows.map((row) => ({ rowKey: row.rowKey, excluded: row.excluded, entries: row.entries }));

const buildChangePreview = (
  published: TeamRosterRow,
  changes: RosterCellChange[],
  rows: TeamRosterRowRow[],
): TeamRosterChangePreview => ({
  comparedRevision: published.revision ?? 0,
  totalChangedCells: changes.length,
  rows: rows.flatMap((row) => {
    const rowChanges = changes
      .filter((change) => change.rowKey === row.rowKey)
      .map(({ date, fromCode, toCode }) => ({ date, fromCode, toCode }));

    return rowChanges.length > 0
      ? [{ rowKey: row.rowKey, displayName: row.displayName, changes: rowChanges }]
      : [];
  }),
});

const listLinkedMembers = async (db: DbExecutor, teamId: string) => {
  const rows = await db
    .select({ userId: teamMembers.userId, rowKey: teamMembers.linkedRowKey, displayName: users.displayName })
    .from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.userId))
    .where(
      and(
        eq(teamMembers.teamId, teamId),
        eq(teamMembers.status, TeamMemberStatus.ACTIVE),
        isNotNull(teamMembers.linkedRowKey),
      ),
    );

  return new Map(rows.map((row) => [row.rowKey ?? '', { userId: row.userId, displayName: row.displayName }]));
};

/** The admin's full roster view (review data, source cells, blockers, change preview). */
export const buildRosterResponse = async (
  db: DbExecutor,
  roster: TeamRosterRow,
): Promise<TeamRosterResponse> => {
  const rows = await listRosterRows(db, roster.id);
  const job = await findRosterJob(db, roster);
  const progress = buildRosterProgress(roster, rows, job);
  const published = roster.yearMonth ? await findPublishedRoster(db, roster.teamId, roster.yearMonth) : null;
  const compareWith =
    published && published.id !== roster.id && roster.status === TeamRosterStatus.DRAFT ? published : null;
  const previousRows = compareWith ? await listRosterRows(db, compareWith.id) : [];
  const match = matchRowKeys(
    previousRows.map((row) => row.rowKey),
    rows.map((row) => row.rowKey),
  );
  const added = new Set(match.added);
  const missing = new Set(match.missing);
  const linked = await listLinkedMembers(db, roster.teamId);
  const labels = computeSameNameLabels(rows.map((row) => row.displayName));
  // Blockers once per row, reused by the row DTOs and the roster-level list.
  const rowBlockers = rows.map((row) =>
    row.excluded ? [] : getPublishBlockers(row.entries, roster.definitions),
  );
  const blockers = rows.flatMap((row, index): TeamRosterRowBlocker[] => {
    const list = rowBlockers[index] ?? [];

    return list.length > 0
      ? [{ rowId: row.id, rowKey: row.rowKey, displayName: row.displayName, blockers: list }]
      : [];
  });
  const changes = compareWith ? diffRosterRows(toDiffRows(previousRows), toDiffRows(rows)) : [];

  return {
    roster: toRosterDto(roster, job),
    progress,
    definitions: roster.definitions,
    rows: rows.map((row, index) => ({
      id: row.id,
      rowKey: row.rowKey,
      displayName: row.displayName,
      sameNameOrdinal: labels[index]?.sameNameOrdinal ?? 1,
      sameNameCount: labels[index]?.sameNameCount ?? 1,
      position: row.position,
      entries: row.entries,
      sourceCells: row.sourceCells,
      excluded: row.excluded,
      extractStatus: row.extractStatus,
      attemptCount: row.attemptCount,
      extractErrorCode: row.extractErrorCode,
      reviewCount: row.reviewCount,
      blockers: rowBlockers[index] ?? [],
      linkedMember: linked.get(row.rowKey) ?? null,
      isNewPerson: compareWith !== null && added.has(row.rowKey),
    })),
    blockers,
    publishable:
      roster.status === TeamRosterStatus.DRAFT &&
      roster.yearMonth !== null &&
      progress.phase === TeamRosterPhase.READY &&
      blockers.length === 0 &&
      rows.some((row) => !row.excluded),
    latestPublishedRevision: published?.revision ?? 0,
    unmatchedPreviousRows: previousRows
      .filter((row) => !row.excluded && missing.has(row.rowKey))
      .map((row) => ({ rowKey: row.rowKey, displayName: row.displayName, linked: linked.has(row.rowKey) })),
    changesPreview: compareWith ? buildChangePreview(compareWith, changes, rows) : null,
  };
};

/** GET /api/teams/:id/rosters/:rid (ADMIN). */
export const getTeamRoster = async (
  db: DbExecutor,
  context: RequestContext,
  teamId: string,
  rosterId: string,
): Promise<TeamRosterResponse> => {
  const { team } = await requireTeamAdmin(db, context, teamId);

  return buildRosterResponse(db, await requireTeamRoster(db, team.id, rosterId));
};

/** GET /api/teams/:id/rosters (ADMIN): every roster, newest first. */
export const listTeamRosters = async (
  db: DbExecutor,
  context: RequestContext,
  teamId: string,
): Promise<TeamRosterListResponse> => {
  const { team } = await requireTeamAdmin(db, context, teamId);
  const rosters = await db
    .select({ roster: teamRosters, job: recognitionJobs })
    .from(teamRosters)
    .leftJoin(recognitionJobs, eq(recognitionJobs.id, teamRosters.sourceJobId))
    .where(eq(teamRosters.teamId, team.id))
    .orderBy(desc(teamRosters.createdAt), desc(teamRosters.id));
  // One query for every roster's rows instead of one per roster.
  const rowsByRoster = await listRowsByRoster(
    db,
    rosters.map(({ roster }) => roster.id),
  );

  return {
    rosters: rosters.map(({ roster, job }) => ({
      ...toRosterDto(roster, job),
      progress: buildRosterProgress(roster, rowsByRoster.get(roster.id) ?? [], job),
    })),
  };
};

/** GET /api/teams/:id/rosters/:rid/source (ADMIN): the upload's photo while it is kept, else 410. */
export const readRosterSourceImage = async (
  db: DbExecutor,
  context: RequestContext,
  teamId: string,
  rosterId: string,
): Promise<{ bytes: Buffer; mime: string }> => {
  const { team } = await requireTeamAdmin(db, context, teamId);
  const job = await findRosterJob(db, await requireTeamRoster(db, team.id, rosterId));
  const bytes = job && isSourceAvailable(job) ? await readSourceBytes(job) : null;

  if (!job || !bytes) {
    throw new ApiError(ApiErrorCode.EXPIRED, { message: SOURCE_GONE_MESSAGE });
  }

  return { bytes, mime: job.sourceMime };
};
