import 'server-only';

import { and, asc, eq, gt, inArray, lt, lte, or, sql } from 'drizzle-orm';

import { resolveDefinedCodes } from '@/domain/DefinedCodeResolver';
import { LEASE_GRACE_MS, MAX_ROW_ATTEMPTS } from '@/domain/DomainLimits';
import { RecognitionErrorCode } from '@/domain/enums/RecognitionErrorCode';
import { RosterRowExtractStatus } from '@/domain/enums/RosterRowExtractStatus';
import { TeamRosterStatus } from '@/domain/enums/TeamRosterStatus';
import { type NormalizedSchedule } from '@/domain/types/NormalizedSchedule';
import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';
import { getAppConfig } from '@/server/config/AppConfig';
import { type Db, type DbExecutor } from '@/server/db/Database';
import { type TeamRosterRowRow, teamRosterRows, teamRosters } from '@/server/db/Schema';
import { isRowRetryable } from '@/server/services/TeamRosterProgressBuilder';
import { countReviewDates, listRosterRows } from '@/server/services/TeamRosterRows';

/** Rows read per extract-next call, in parallel (Team spec §6, N = 4). */
const EXTRACT_BATCH_SIZE = 4;

export type RowOutcome =
  { ok: true; schedule: NormalizedSchedule } | { ok: false; errorCode: RecognitionErrorCode };

/** A claimed row: the lease this call holds is identified by (id, attemptCount). */
export type ClaimedRow = TeamRosterRowRow;

const buildLeaseExpiry = (now: Date): Date =>
  new Date(now.getTime() + getAppConfig().visionTimeoutMs + LEASE_GRACE_MS);

/** "다시 시도": FAILED rows that `isRowRetryable` accepts go back to PENDING (same rule as the counts). */
export const requeueRetryableRows = async (db: DbExecutor, rosterId: string, now: Date): Promise<void> => {
  const ids = (await listRosterRows(db, rosterId))
    .filter((row) => isRowRetryable(row, now))
    .map((row) => row.id);

  if (ids.length === 0) {
    return;
  }

  await db
    .update(teamRosterRows)
    .set({ extractStatus: RosterRowExtractStatus.PENDING, extractErrorCode: null, leaseExpiresAt: null })
    .where(and(inArray(teamRosterRows.id, ids), lt(teamRosterRows.attemptCount, MAX_ROW_ATTEMPTS)));
};

/** Expired leases without attempts left are final failures (the browser closed after the last try). */
export const failExhaustedLeases = async (db: DbExecutor, rosterId: string, now: Date): Promise<void> => {
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
export const claimRows = async (db: Db, rosterId: string, now: Date): Promise<ClaimedRow[]> =>
  db.transaction(async (tx) => {
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
        leaseExpiresAt: buildLeaseExpiry(now),
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

/** Same lease identity: this call's claim (status + attempt) and the lease still running. */
const buildLeaseFence = (row: ClaimedRow, now: Date) =>
  and(
    eq(teamRosterRows.id, row.id),
    eq(teamRosterRows.extractStatus, RosterRowExtractStatus.PROCESSING),
    eq(teamRosterRows.attemptCount, row.attemptCount),
    gt(teamRosterRows.leaseExpiresAt, now),
  );

/**
 * Restarts the leases after the (possibly slow) image preparation, so preparation time never eats into the
 * provider budget the lease was sized for. Rows another call took over in between are left alone.
 */
export const renewLeases = async (db: DbExecutor, rows: ClaimedRow[]): Promise<void> => {
  const now = new Date();

  for (const row of rows) {
    await db
      .update(teamRosterRows)
      .set({ leaseExpiresAt: buildLeaseExpiry(now) })
      .where(buildLeaseFence(row, now));
  }
};

/** Codes first seen in this row join the roster legend (existing definitions are never overwritten). */
const mergeDefinitions = (current: ShiftDefinition[], added: ShiftDefinition[]): ShiftDefinition[] => {
  const known = new Set(current.map((definition) => definition.code));

  return [...current, ...added.filter((definition) => !known.has(definition.code))];
};

/**
 * Writes one outcome only while this call still holds the row's lease and the roster is still a DRAFT of the
 * month that was read. Returns whether it stored anything. Late results (lease expired or taken over, row
 * edited to MANUAL, roster published, month changed) are discarded; a month change requeues the row without
 * spending the attempt. A new legend code bumps the roster `version` (an admin's PATCH with the old legend
 * then gets 409 and reloads instead of silently dropping the code).
 */
export const storeOutcome = async (
  db: Db,
  rosterId: string,
  row: ClaimedRow,
  outcome: RowOutcome,
  yearMonth: string,
): Promise<boolean> =>
  db.transaction(async (tx) => {
    const [roster] = await tx.select().from(teamRosters).where(eq(teamRosters.id, rosterId)).for('update');

    // Published meanwhile: never touch rows members may already see.
    if (!roster || roster.status !== TeamRosterStatus.DRAFT) {
      return false;
    }

    const now = new Date();
    const fence = buildLeaseFence(row, now);

    // Extraction counts as activity, so the draft TTL never removes a roster being read.
    await tx.update(teamRosters).set({ updatedAt: now }).where(eq(teamRosters.id, rosterId));

    if (roster.yearMonth !== yearMonth) {
      await tx
        .update(teamRosterRows)
        .set({
          extractStatus: RosterRowExtractStatus.PENDING,
          attemptCount: sql`${teamRosterRows.attemptCount} - 1`,
          leaseExpiresAt: null,
        })
        .where(fence);

      return false;
    }

    if (!outcome.ok) {
      const failed = await tx
        .update(teamRosterRows)
        .set({
          extractStatus: RosterRowExtractStatus.FAILED,
          extractErrorCode: outcome.errorCode,
          leaseExpiresAt: null,
        })
        .where(fence)
        .returning({ id: teamRosterRows.id });

      return failed.length > 0;
    }

    const definitions = mergeDefinitions(roster.definitions, outcome.schedule.definitions);
    const entries = resolveDefinedCodes(outcome.schedule.entries, definitions);
    const stored = await tx
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

    if (stored.length > 0 && definitions.length !== roster.definitions.length) {
      await tx
        .update(teamRosters)
        .set({ definitions, version: roster.version + 1 })
        .where(eq(teamRosters.id, rosterId));
    }

    return stored.length > 0;
  });
