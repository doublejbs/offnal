import 'server-only';

import { eq } from 'drizzle-orm';

import { resolveDefinedCodes } from '@/domain/DefinedCodeResolver';
import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { RevisionConflictReason } from '@/domain/enums/RevisionConflictReason';
import { RosterRowExtractStatus } from '@/domain/enums/RosterRowExtractStatus';
import { TeamRosterStatus } from '@/domain/enums/TeamRosterStatus';
import { buildNextRowKey, computeSameNameLabels } from '@/domain/TeamRowKey';
import { type PatchTeamRosterRequest } from '@/domain/types/api/PatchTeamRosterRequest';
import { type TeamRosterResponse } from '@/domain/types/api/TeamRosterResponse';
import { type Db, type DbTransaction } from '@/server/db/Database';
import { type TeamRosterRow, teamRosterRows, teamRosters } from '@/server/db/Schema';
import { ApiError } from '@/server/errors/ApiError';
import { type RequestContext } from '@/server/http/RequestContext';
import { normalizeDefinitions } from '@/server/services/DraftService';
import { assertTeamPlanActive, requireTeamAdmin } from '@/server/services/TeamAccess';
import {
  buildRowWrite,
  diffRowState,
  requireMonthEntries,
  type RowState,
  toState,
  validatePatch,
} from '@/server/services/TeamRosterRowEdits';
import {
  buildRosterResponse,
  requireTeamRoster,
  throwRosterConflict,
} from '@/server/services/TeamRosterQueries';
import {
  buildEmptyMonth,
  countReviewDates,
  findLatestRevision,
  findPublishedRoster,
  listRosterRows,
} from '@/server/services/TeamRosterRows';

const NOT_READY_MESSAGE = '아직 근무표를 읽는 중이에요. 잠시 후 다시 시도해 주세요.';

/** Thrown inside the transaction; turned into a 409 with the current roster after rollback. */
class StaleRosterVersion extends Error {}

const applyPatch = async (
  tx: DbTransaction,
  roster: TeamRosterRow,
  body: PatchTeamRosterRequest,
): Promise<void> => {
  const fromYearMonth = roster.yearMonth ?? '';
  const yearMonth = body.yearMonth ?? fromYearMonth;
  const definitions = body.definitions ? normalizeDefinitions(body.definitions) : roster.definitions;
  const rows = await listRosterRows(tx, roster.id);
  const now = new Date();

  validatePatch(rows, body, yearMonth !== fromYearMonth, now);

  const patches = new Map((body.rows ?? []).map((patch) => [patch.rowId, patch]));
  const published = await findPublishedRoster(tx, roster.teamId, yearMonth);
  const previousKeys = new Set(
    published ? (await listRosterRows(tx, published.id)).map((row) => row.rowKey) : [],
  );
  const usedKeys = new Set(rows.map((row) => row.rowKey));
  const context = { fromYearMonth, yearMonth, previousKeys, usedKeys, now };
  const existing = rows.map((row) => ({
    ...toState(row),
    ...buildRowWrite(row, patches.get(row.id), context),
  }));
  let position = rows.reduce((highest, row) => Math.max(highest, row.position), -1);
  const added: RowState[] = (body.addRows ?? []).map((row) => {
    const rowKey = buildNextRowKey(row.displayName, usedKeys);

    usedKeys.add(rowKey);
    position += 1;

    return {
      rowKey,
      displayName: row.displayName,
      entries: row.entries
        ? requireMonthEntries(row.entries, yearMonth)
        : buildEmptyMonth(yearMonth, definitions).entries,
      sourceCells: [],
      excluded: false,
      extractStatus: RosterRowExtractStatus.MANUAL,
      position,
    };
  });
  const all = [...existing, ...added];
  const labels = computeSameNameLabels(all.map((row) => row.displayName));
  const finals = all.map((row, index) => {
    // Spec §16: one definition confirms every entry that only waited for it, in every row.
    const entries = resolveDefinedCodes(row.entries, definitions);

    return {
      ...row,
      entries,
      reviewCount: countReviewDates(entries),
      sameNameOrdinal: labels[index]?.sameNameOrdinal ?? 1,
    };
  });

  for (const [index, row] of rows.entries()) {
    const final = finals[index];
    const changes = final ? diffRowState(row, final) : {};

    if (Object.keys(changes).length > 0) {
      await tx.update(teamRosterRows).set(changes).where(eq(teamRosterRows.id, row.id));
    }
  }

  const inserts = finals.slice(rows.length);

  if (inserts.length > 0) {
    await tx.insert(teamRosterRows).values(inserts.map((row) => ({ ...row, rosterId: roster.id })));
  }

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

    throwRosterConflict({
      reason: RevisionConflictReason.STALE_REVISION,
      currentVersion: current.roster.version,
      roster: current,
    });
  }

  return buildRosterResponse(db, await requireTeamRoster(db, team.id, roster.id));
};
