import 'server-only';

import { and, asc, eq, gt, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';

import { resolveDefinedCodes } from '@/domain/DefinedCodeResolver';
import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { RecognitionErrorCode } from '@/domain/enums/RecognitionErrorCode';
import { RosterRowExtractStatus } from '@/domain/enums/RosterRowExtractStatus';
import { TeamRosterStatus } from '@/domain/enums/TeamRosterStatus';
import { type ExtractNextRequest } from '@/domain/types/api/ExtractNextRequest';
import { type ExtractNextResponse } from '@/domain/types/api/ExtractNextResponse';
import { type NormalizedSchedule } from '@/domain/types/NormalizedSchedule';
import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';
import { getAppConfig } from '@/server/config/AppConfig';
import { type Db, type DbExecutor } from '@/server/db/Database';
import { type TeamRosterRowRow, teamRosterRows, teamRosters } from '@/server/db/Schema';
import { ApiError } from '@/server/errors/ApiError';
import { type RequestContext } from '@/server/http/RequestContext';
import {
  extractRowWithPreparedImage,
  type PreparedJobImage,
  type PreparedJobImageResult,
  RowExtractionError,
  tryPrepareJobImage,
} from '@/server/services/RecognitionPersonExtractor';
import { RETRYABLE_ERROR_CODES } from '@/server/services/RecognitionOwnership';
import { assertTeamPlanActive, requireTeamAdmin } from '@/server/services/TeamAccess';
import { requireTeamRoster } from '@/server/services/TeamRosterQueries';
import {
  buildRosterProgress,
  MAX_ROW_ATTEMPTS,
  toFailedRows,
} from '@/server/services/TeamRosterProgressBuilder';
import { countReviewDates, listRosterRows } from '@/server/services/TeamRosterRows';
import { ensureRosterRows } from '@/server/services/TeamRosterUploadService';

/** Rows read per extract-next call, in parallel (Team spec §6, N = 4). */
export const EXTRACT_BATCH_SIZE = 4;

/** Extra lease time beyond the provider timeout so a slow finish is not taken over mid-write. */
const ROW_LEASE_GRACE_MS = 30_000;

type RowOutcome = { ok: true; schedule: NormalizedSchedule } | { ok: false; errorCode: RecognitionErrorCode };

/** FAILED rows with attempts left go back to PENDING (the "다시 시도" button). */
const requeueFailedRows = async (db: DbExecutor, rosterId: string): Promise<void> => {
  await db
    .update(teamRosterRows)
    .set({ extractStatus: RosterRowExtractStatus.PENDING, extractErrorCode: null })
    .where(
      and(
        eq(teamRosterRows.rosterId, rosterId),
        eq(teamRosterRows.extractStatus, RosterRowExtractStatus.FAILED),
        eq(teamRosterRows.excluded, false),
        lt(teamRosterRows.attemptCount, MAX_ROW_ATTEMPTS),
        or(
          isNull(teamRosterRows.extractErrorCode),
          inArray(teamRosterRows.extractErrorCode, RETRYABLE_ERROR_CODES),
        ),
      ),
    );
};

/** Expired leases without attempts left are final failures (the browser closed after the last try). */
const failExhaustedLeases = async (db: DbExecutor, rosterId: string, now: Date): Promise<void> => {
  await db
    .update(teamRosterRows)
    .set({
      extractStatus: RosterRowExtractStatus.FAILED,
      leaseExpiresAt: null,
      extractErrorCode: RecognitionErrorCode.PROVIDER_TIMEOUT,
    })
    .where(
      and(
        eq(teamRosterRows.rosterId, rosterId),
        eq(teamRosterRows.extractStatus, RosterRowExtractStatus.PROCESSING),
        lte(teamRosterRows.leaseExpiresAt, now),
        sql`${teamRosterRows.attemptCount} >= ${MAX_ROW_ATTEMPTS}`,
      ),
    );
};

const claimableCondition = (now: Date) =>
  and(
    eq(teamRosterRows.excluded, false),
    lt(teamRosterRows.attemptCount, MAX_ROW_ATTEMPTS),
    or(
      eq(teamRosterRows.extractStatus, RosterRowExtractStatus.PENDING),
      and(
        eq(teamRosterRows.extractStatus, RosterRowExtractStatus.PROCESSING),
        lte(teamRosterRows.leaseExpiresAt, now),
      ),
    ),
  );

/**
 * Atomic claim: in one transaction, lock up to N claimable rows (`FOR UPDATE SKIP LOCKED`, so a concurrent
 * call skips them instead of waiting) and lease them; the UPDATE re-checks the claimable condition. Two-step
 * on purpose: an `UPDATE … WHERE id IN (SELECT … LIMIT n)` may re-run the subquery and lease more than n.
 * Concurrent extract-next calls never get the same row.
 */
const claimRows = async (db: Db, rosterId: string, now: Date): Promise<TeamRosterRowRow[]> => {
  const leaseExpiresAt = new Date(now.getTime() + getAppConfig().visionTimeoutMs + ROW_LEASE_GRACE_MS);

  return db.transaction(async (tx) => {
    const candidates = await tx
      .select({ id: teamRosterRows.id })
      .from(teamRosterRows)
      .where(and(eq(teamRosterRows.rosterId, rosterId), claimableCondition(now)))
      .orderBy(asc(teamRosterRows.position))
      .limit(EXTRACT_BATCH_SIZE)
      .for('update', { skipLocked: true });

    if (candidates.length === 0) {
      return [];
    }

    const claimed = await tx
      .update(teamRosterRows)
      .set({
        extractStatus: RosterRowExtractStatus.PROCESSING,
        attemptCount: sql`${teamRosterRows.attemptCount} + 1`,
        leaseExpiresAt,
        extractErrorCode: null,
      })
      .where(
        and(
          inArray(
            teamRosterRows.id,
            candidates.map((candidate) => candidate.id),
          ),
          claimableCondition(now),
        ),
      )
      .returning();

    return claimed.sort((left, right) => left.position - right.position);
  });
};

const readRow = async (
  image: PreparedJobImage,
  row: TeamRosterRowRow,
  yearMonth: string,
): Promise<RowOutcome> => {
  if (!row.sourceRowId) {
    return { ok: false, errorCode: RecognitionErrorCode.SOURCE_MISSING };
  }

  try {
    return {
      ok: true,
      schedule: await extractRowWithPreparedImage(image, row.sourceRowId, row.displayName, yearMonth),
    };
  } catch (error: unknown) {
    if (error instanceof RowExtractionError) {
      return { ok: false, errorCode: error.errorCode };
    }

    throw error;
  }
};

/** Codes first seen in this row join the roster legend (existing definitions are never overwritten). */
const mergeDefinitions = (current: ShiftDefinition[], added: ShiftDefinition[]): ShiftDefinition[] => {
  const known = new Set(current.map((definition) => definition.code));

  return [...current, ...added.filter((definition) => !known.has(definition.code))];
};

/** Writes one outcome if this call still holds the row's lease (fenced by status + attempt count). */
const storeOutcome = async (
  db: Db,
  rosterId: string,
  row: TeamRosterRowRow,
  outcome: RowOutcome,
  yearMonth: string,
): Promise<void> => {
  await db.transaction(async (tx) => {
    const [roster] = await tx.select().from(teamRosters).where(eq(teamRosters.id, rosterId)).for('update');

    // Published meanwhile: never touch rows members may already see.
    if (!roster || roster.status !== TeamRosterStatus.DRAFT) {
      return;
    }

    const fence = and(
      eq(teamRosterRows.id, row.id),
      eq(teamRosterRows.extractStatus, RosterRowExtractStatus.PROCESSING),
      eq(teamRosterRows.attemptCount, row.attemptCount),
      gt(teamRosterRows.leaseExpiresAt, new Date()),
    );

    // Extraction counts against activity, so the draft TTL never removes a roster being read.
    await tx.update(teamRosters).set({ updatedAt: new Date() }).where(eq(teamRosters.id, rosterId));

    if (roster.yearMonth !== yearMonth) {
      // The month changed mid-read: queue the row again without spending the attempt.
      await tx
        .update(teamRosterRows)
        .set({
          extractStatus: RosterRowExtractStatus.PENDING,
          attemptCount: sql`${teamRosterRows.attemptCount} - 1`,
          leaseExpiresAt: null,
        })
        .where(fence);

      return;
    }

    if (!outcome.ok) {
      await tx
        .update(teamRosterRows)
        .set({
          extractStatus: RosterRowExtractStatus.FAILED,
          extractErrorCode: outcome.errorCode,
          leaseExpiresAt: null,
        })
        .where(fence);

      return;
    }

    const definitions = mergeDefinitions(roster.definitions, outcome.schedule.definitions);
    const entries = resolveDefinedCodes(outcome.schedule.entries, definitions);
    const [stored] = await tx
      .update(teamRosterRows)
      .set({
        extractStatus: RosterRowExtractStatus.DONE,
        entries,
        sourceCells: outcome.schedule.sourceCells,
        reviewCount: countReviewDates(entries),
        leaseExpiresAt: null,
      })
      .where(fence)
      .returning({ id: teamRosterRows.id });

    if (stored && definitions.length !== roster.definitions.length) {
      await tx.update(teamRosters).set({ definitions }).where(eq(teamRosters.id, rosterId));
    }
  });
};

/**
 * POST /api/teams/:id/rosters/:rid/extract-next (ADMIN, DRAFT): first pass if needed, then up to 4 rows in
 * parallel. State lives in the rows, so a closed browser resumes where it stopped.
 */
export const extractNextRows = async (
  db: Db,
  context: RequestContext,
  teamId: string,
  rosterId: string,
  body: ExtractNextRequest,
): Promise<ExtractNextResponse> => {
  const { team } = await requireTeamAdmin(db, context, teamId);
  const roster = await requireTeamRoster(db, team.id, rosterId);

  if (roster.status !== TeamRosterStatus.DRAFT) {
    throw new ApiError(ApiErrorCode.ROSTER_NOT_EDITABLE);
  }

  await assertTeamPlanActive(db, team.id);

  const job = await ensureRosterRows(db, roster);
  const [current] = await db.select().from(teamRosters).where(eq(teamRosters.id, roster.id));
  const processedRowIds: string[] = [];

  if (current?.rowsCreatedAt && current.yearMonth) {
    const now = new Date();

    if (body.retryFailed) {
      await requeueFailedRows(db, roster.id);
    }

    await failExhaustedLeases(db, roster.id, now);

    const claimed = await claimRows(db, roster.id, now);

    if (claimed.length > 0) {
      const prepared: PreparedJobImageResult = job?.tableResult
        ? await tryPrepareJobImage(job, job.tableResult)
        : { ok: false, errorCode: RecognitionErrorCode.SOURCE_MISSING };
      const yearMonth = current.yearMonth;
      // Rows of one batch are read in parallel from the same prepared image.
      const settled = await Promise.allSettled(
        claimed.map(async (row): Promise<RowOutcome> =>
          prepared.ok ? readRow(prepared.image, row, yearMonth) : prepared,
        ),
      );

      for (const [index, row] of claimed.entries()) {
        const result = settled[index];
        // An unexpected error fails only that row; the batch's other results are kept.
        const outcome: RowOutcome | undefined =
          result?.status === 'fulfilled'
            ? result.value
            : result && { ok: false, errorCode: RecognitionErrorCode.PROVIDER_ERROR };

        if (result?.status === 'rejected') {
          console.warn('[team] row extraction crashed', {
            name: result.reason instanceof Error ? result.reason.name : typeof result.reason,
          });
        }

        if (outcome) {
          await storeOutcome(db, roster.id, row, outcome, yearMonth);
          processedRowIds.push(row.id);
        }
      }
    }
  }

  const [latest] = await db.select().from(teamRosters).where(eq(teamRosters.id, roster.id));
  const rows = await listRosterRows(db, roster.id);
  const now = new Date();

  return {
    progress: buildRosterProgress(latest ?? roster, rows, job, now),
    processedRowIds,
    failedRows: toFailedRows(
      rows.filter((row) => processedRowIds.includes(row.id)),
      now,
    ),
  };
};
