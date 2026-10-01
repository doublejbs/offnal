import 'server-only';

import { eq } from 'drizzle-orm';

import { resolveDefinedCodes } from '@/domain/DefinedCodeResolver';
import { remapDraftMonth } from '@/domain/DraftMonthRemapper';
import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { RevisionConflictReason } from '@/domain/enums/RevisionConflictReason';
import { RosterRowExtractStatus } from '@/domain/enums/RosterRowExtractStatus';
import { TeamRosterStatus } from '@/domain/enums/TeamRosterStatus';
import { hasExactDateSet, normalizeExtraction } from '@/domain/ScheduleValidator';
import { buildNextRowKey } from '@/domain/TeamRowKey';
import { type PatchTeamRosterRequest } from '@/domain/types/api/PatchTeamRosterRequest';
import { type TeamRosterConflictDetails } from '@/domain/types/api/TeamRosterConflictDetails';
import { type TeamRosterResponse } from '@/domain/types/api/TeamRosterResponse';
import { type TeamRosterRowPatch } from '@/domain/types/api/TeamRosterRowPatch';
import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';
import { type ShiftEntry } from '@/domain/types/ShiftEntry';
import { type SourceCell } from '@/domain/types/SourceCell';
import { dayOfDate, listDates } from '@/domain/YearMonth';
import { type Db, type DbTransaction } from '@/server/db/Database';
import { type TeamRosterRow, type TeamRosterRowRow, teamRosterRows, teamRosters } from '@/server/db/Schema';
import { ApiError } from '@/server/errors/ApiError';
import { type RequestContext } from '@/server/http/RequestContext';
import { normalizeDefinitions, normalizeEntries } from '@/server/services/DraftService';
import { assertTeamPlanActive, requireTeamAdmin } from '@/server/services/TeamAccess';
import { classifyRow } from '@/server/services/TeamRosterProgressBuilder';
import { buildRosterResponse, requireTeamRoster } from '@/server/services/TeamRosterQueries';
import {
  countReviewDates,
  findPublishedRoster,
  listRosterRows,
  refreshSameNameOrdinals,
} from '@/server/services/TeamRosterRows';
import { findLatestRevision } from '@/server/services/TeamRosterUploadService';

const ROW_BUSY_MESSAGE = '아직 읽는 중인 사람이 있어요. 읽기가 끝난 뒤 고쳐 주세요.';
const NOT_READY_MESSAGE = '아직 근무표를 읽는 중이에요. 잠시 후 다시 시도해 주세요.';

/** Thrown inside the transaction; turned into a 409 with the current roster after rollback. */
class StaleRosterVersion extends Error {}

const validationError = (message: string, field: string): ApiError =>
  new ApiError(ApiErrorCode.VALIDATION_ERROR, { message, details: { fields: [field] } });

const requireMonthEntries = (entries: ShiftEntry[], yearMonth: string): ShiftEntry[] => {
  if (!hasExactDateSet(entries, yearMonth)) {
    throw validationError('대상 월의 모든 날짜가 한 번씩 있어야 해요.', 'entries');
  }

  return normalizeEntries(entries);
};

const remapSourceCells = (cells: SourceCell[], toYearMonth: string): SourceCell[] => {
  const byDay = new Map(cells.map((cell) => [dayOfDate(cell.date), cell.rawText]));

  return listDates(toYearMonth).map((date) => ({ date, rawText: byDay.get(dayOfDate(date)) ?? null }));
};

type RowWrite = {
  rowKey?: string;
  displayName?: string;
  entries?: ShiftEntry[];
  sourceCells?: SourceCell[];
  excluded?: boolean;
  extractStatus?: RosterRowExtractStatus;
};

const buildRowWrite = (
  row: TeamRosterRowRow,
  patch: TeamRosterRowPatch | undefined,
  context: {
    fromYearMonth: string;
    yearMonth: string;
    previousKeys: Set<string>;
    usedKeys: Set<string>;
    now: Date;
  },
): RowWrite => {
  const write: RowWrite = {};

  if (
    patch &&
    [RosterRowExtractStatus.PENDING, RosterRowExtractStatus.PROCESSING].includes(
      classifyRow(row, context.now),
    )
  ) {
    throw new ApiError(ApiErrorCode.ROSTER_NOT_EDITABLE, { message: ROW_BUSY_MESSAGE });
  }

  if (context.yearMonth !== context.fromYearMonth) {
    write.entries = remapDraftMonth(row.entries, context.fromYearMonth, context.yearMonth);
    write.sourceCells = remapSourceCells(row.sourceCells, context.yearMonth);
  }

  if (!patch) {
    return write;
  }

  if (patch.entries) {
    write.entries = requireMonthEntries(patch.entries, context.yearMonth);
    // Classified, not raw: a PROCESSING row whose last lease ran out counts as FAILED and becomes MANUAL.
    write.extractStatus =
      classifyRow(row, context.now) === RosterRowExtractStatus.FAILED
        ? RosterRowExtractStatus.MANUAL
        : row.extractStatus;
  }

  if (patch.displayName !== undefined) {
    write.displayName = patch.displayName;
  }

  if (patch.excluded !== undefined) {
    write.excluded = patch.excluded;
  }

  if (patch.matchRowKey !== undefined && patch.matchRowKey !== row.rowKey) {
    if (!context.previousKeys.has(patch.matchRowKey) || context.usedKeys.has(patch.matchRowKey)) {
      throw validationError(
        '이전 근무표에 있고 이 초안에서 쓰이지 않은 사람만 이어 붙일 수 있어요.',
        'matchRowKey',
      );
    }

    context.usedKeys.delete(row.rowKey);
    context.usedKeys.add(patch.matchRowKey);
    write.rowKey = patch.matchRowKey;
  }

  return write;
};

const applyPatch = async (
  tx: DbTransaction,
  roster: TeamRosterRow,
  body: PatchTeamRosterRequest,
): Promise<void> => {
  const fromYearMonth = roster.yearMonth ?? '';
  const yearMonth = body.yearMonth ?? fromYearMonth;
  const definitions: ShiftDefinition[] = body.definitions
    ? normalizeDefinitions(body.definitions)
    : roster.definitions;
  const rows = await listRosterRows(tx, roster.id);
  const patches = new Map((body.rows ?? []).map((patch) => [patch.rowId, patch]));
  const published = await findPublishedRoster(tx, roster.teamId, yearMonth);
  const previousKeys = new Set(
    published ? (await listRosterRows(tx, published.id)).map((row) => row.rowKey) : [],
  );
  const usedKeys = new Set(rows.map((row) => row.rowKey));
  const now = new Date();

  if (
    (body.rows ?? []).some((patch) => !rows.some((row) => row.id === patch.rowId)) ||
    patches.size !== (body.rows ?? []).length
  ) {
    throw validationError('근무표에 없는 행이에요.', 'rows');
  }

  // Rows being read would store the old month's dates: change the month once reading finished.
  if (
    yearMonth !== fromYearMonth &&
    rows.some((row) =>
      [RosterRowExtractStatus.PENDING, RosterRowExtractStatus.PROCESSING].includes(classifyRow(row, now)),
    )
  ) {
    throw new ApiError(ApiErrorCode.ROSTER_NOT_EDITABLE, { message: ROW_BUSY_MESSAGE });
  }

  for (const row of rows) {
    const write = buildRowWrite(row, patches.get(row.id), {
      fromYearMonth,
      yearMonth,
      previousKeys,
      usedKeys,
      now,
    });
    // Spec §16: one definition confirms every entry that only waited for it, in every row.
    const entries = resolveDefinedCodes(write.entries ?? row.entries, definitions);

    await tx
      .update(teamRosterRows)
      .set({ ...write, entries, reviewCount: countReviewDates(entries) })
      .where(eq(teamRosterRows.id, row.id));
  }

  let position = rows.reduce((highest, row) => Math.max(highest, row.position), -1);

  for (const added of body.addRows ?? []) {
    const rowKey = buildNextRowKey(added.displayName, usedKeys);
    const empty = normalizeExtraction(
      { yearMonth, rowId: '', displayName: '', definitions, cells: [] },
      yearMonth,
    );
    const entries = resolveDefinedCodes(
      added.entries ? requireMonthEntries(added.entries, yearMonth) : empty.entries,
      definitions,
    );

    usedKeys.add(rowKey);
    position += 1;
    await tx.insert(teamRosterRows).values({
      rosterId: roster.id,
      rowKey,
      displayName: added.displayName,
      position,
      entries,
      sourceCells: [],
      extractStatus: RosterRowExtractStatus.MANUAL,
      reviewCount: countReviewDates(entries),
    });
  }

  await refreshSameNameOrdinals(tx, roster.id);
  await tx
    .update(teamRosters)
    .set({
      yearMonth,
      definitions,
      version: roster.version + 1,
      ...(yearMonth !== fromYearMonth
        ? { baseRevision: await findLatestRevision(tx, roster.teamId, yearMonth) }
        : {}),
    })
    .where(eq(teamRosters.id, roster.id));
};

/**
 * PATCH /api/teams/:id/rosters/:rid (ADMIN, DRAFT): cells, definitions, names, exclusion, "이름 바뀜" links and
 * new rows in one optimistic update (`version`, 409 on mismatch). Rows still being read are refused.
 */
export const patchTeamRoster = async (
  db: Db,
  context: RequestContext,
  teamId: string,
  rosterId: string,
  body: PatchTeamRosterRequest,
): Promise<TeamRosterResponse> => {
  const { team } = await requireTeamAdmin(db, context, teamId);
  const roster = await requireTeamRoster(db, team.id, rosterId);

  await assertTeamPlanActive(db, team.id);

  try {
    await db.transaction(async (tx) => {
      const [locked] = await tx.select().from(teamRosters).where(eq(teamRosters.id, roster.id)).for('update');

      if (!locked || locked.status !== TeamRosterStatus.DRAFT) {
        throw new ApiError(ApiErrorCode.ROSTER_NOT_EDITABLE);
      }

      if (!locked.rowsCreatedAt || !locked.yearMonth) {
        throw new ApiError(ApiErrorCode.ROSTER_NOT_EDITABLE, { message: NOT_READY_MESSAGE });
      }

      if (locked.version !== body.version) {
        throw new StaleRosterVersion();
      }

      await applyPatch(tx, locked, body);
    });
  } catch (error: unknown) {
    if (!(error instanceof StaleRosterVersion)) {
      throw error;
    }

    const current = await buildRosterResponse(db, await requireTeamRoster(db, team.id, roster.id));
    const details: TeamRosterConflictDetails = {
      reason: RevisionConflictReason.STALE_REVISION,
      currentVersion: current.roster.version,
      roster: current,
    };

    throw new ApiError(ApiErrorCode.REVISION_CONFLICT, { details });
  }

  return buildRosterResponse(db, await requireTeamRoster(db, team.id, roster.id));
};
