import 'server-only';

import { and, asc, eq, exists, inArray, isNotNull, isNull, lt, lte, ne, or, sql } from 'drizzle-orm';

import { MS_PER_DAY, MS_PER_HOUR } from '@/domain/DomainLimits';
import { DraftStatus } from '@/domain/enums/DraftStatus';
import { PaymentStatus } from '@/domain/enums/PaymentStatus';
import { RecognitionStatus } from '@/domain/enums/RecognitionStatus';
import { TeamRosterStatus } from '@/domain/enums/TeamRosterStatus';
import { getAppConfig } from '@/server/config/AppConfig';
import { type Db, type DbExecutor } from '@/server/db/Database';
import {
  anonymousSessions,
  drafts,
  ocrShadowRuns,
  paymentEvents,
  payments,
  rateLimitCounters,
  recognitionJobs,
  sessions,
  teamRosters,
} from '@/server/db/Schema';
import { type ObjectStorage } from '@/server/storage/ObjectStorage';

/** Rate-limit windows are at most a month; keep a margin. */
const RATE_LIMIT_RETENTION_DAYS = 40;
/** Processed webhook events only guard against provider retries, which stop within days. */
const PAYMENT_EVENT_RETENTION_DAYS = 30;
/** Checkout windows are minutes long; an order untouched for a day is abandoned. */
const STALE_PENDING_PAYMENT_HOURS = 24;
/** Shadow OCR statistics (numbers only) are kept for comparison over a quarter (Spec §21-4). */
const OCR_SHADOW_RETENTION_DAYS = 90;
/** Per run, so one invocation stays well inside the function time limit; the next run continues. */
const JOB_BATCH_SIZE = 200;

export type CleanupResult = {
  /** Jobs past their TTL that were marked expired and/or had their temporary table removed. */
  expiredJobs: number;
  /** Source objects deleted (expired jobs + published jobs whose post-publish deletion failed). */
  sourcesDeleted: number;
  /** Deletions that failed this run; retried next run (after the other pending ones). */
  sourceDeleteFailures: number;
  draftsDeleted: number;
  rateLimitCountersDeleted: number;
  sessionsDeleted: number;
  anonymousSessionsDeleted: number;
  paymentsCanceled: number;
  paymentEventsDeleted: number;
  /** Team roster drafts untouched for DRAFT_TTL_DAYS (published revisions are kept). */
  teamRosterDraftsDeleted: number;
  ocrShadowRunsDeleted: number;
};

type SourceRef = {
  id: string;
  sourceObjectKey: string;
};

const daysBefore = (now: Date, days: number): Date => new Date(now.getTime() - days * MS_PER_DAY);

/**
 * Past TTL: temporary table (other people's names) removed and status expired, oldest first. Source
 * deletion is a separate step so a failing object never blocks this one.
 */
const expireJobs = async (db: Db, now: Date): Promise<number> => {
  const expired = await db
    .select({ id: recognitionJobs.id })
    .from(recognitionJobs)
    .where(
      and(
        lte(recognitionJobs.expiresAt, now),
        or(ne(recognitionJobs.status, RecognitionStatus.EXPIRED), isNotNull(recognitionJobs.tableResult)),
      ),
    )
    .orderBy(asc(recognitionJobs.expiresAt))
    .limit(JOB_BATCH_SIZE);

  for (const job of expired) {
    await db
      .update(recognitionJobs)
      .set({ status: RecognitionStatus.EXPIRED, tableResult: null, leaseExpiresAt: null })
      .where(eq(recognitionJobs.id, job.id));
  }

  return expired.length;
};

/**
 * Sources still stored for expired jobs or jobs with a published draft (publish deletes after commit;
 * this retries). Least recently attempted first: a failure bumps `updated_at`, so an object that keeps
 * failing goes to the back of the queue instead of starving the rest.
 */
const listPendingSources = async (db: Db, now: Date): Promise<SourceRef[]> => {
  const rows = await db
    .select({ id: recognitionJobs.id, sourceObjectKey: recognitionJobs.sourceObjectKey })
    .from(recognitionJobs)
    .where(
      and(
        isNotNull(recognitionJobs.sourceObjectKey),
        isNull(recognitionJobs.sourceDeletedAt),
        or(
          lte(recognitionJobs.expiresAt, now),
          exists(
            db
              .select({ one: sql`1` })
              .from(drafts)
              .where(
                and(
                  eq(drafts.recognitionJobId, recognitionJobs.id),
                  eq(drafts.status, DraftStatus.PUBLISHED),
                ),
              ),
          ),
          // Team roster uploads that were published (now PUBLISHED or ARCHIVED).
          exists(
            db
              .select({ one: sql`1` })
              .from(teamRosters)
              .where(
                and(
                  eq(teamRosters.sourceJobId, recognitionJobs.id),
                  inArray(teamRosters.status, [TeamRosterStatus.PUBLISHED, TeamRosterStatus.ARCHIVED]),
                ),
              ),
          ),
        ),
      ),
    )
    .orderBy(asc(recognitionJobs.updatedAt), asc(recognitionJobs.expiresAt))
    .limit(JOB_BATCH_SIZE);

  return rows.flatMap((row) =>
    row.sourceObjectKey ? [{ id: row.id, sourceObjectKey: row.sourceObjectKey }] : [],
  );
};

const deletePendingSources = async (
  db: Db,
  storage: ObjectStorage,
  now: Date,
  result: CleanupResult,
): Promise<void> => {
  for (const job of await listPendingSources(db, now)) {
    try {
      // Already-missing objects are a no-op in both storage drivers, so they are simply marked deleted.
      await storage.delete(job.sourceObjectKey);
    } catch (error: unknown) {
      console.warn('[cleanup] source deletion failed', {
        name: error instanceof Error ? error.name : typeof error,
      });
      result.sourceDeleteFailures += 1;
      await db.update(recognitionJobs).set({ updatedAt: now }).where(eq(recognitionJobs.id, job.id));

      continue;
    }

    await db.update(recognitionJobs).set({ sourceDeletedAt: now }).where(eq(recognitionJobs.id, job.id));
    result.sourcesDeleted += 1;
  }
};

const countDeleted = (rows: unknown[]): number => rows.length;

/**
 * Ends upload jobs right away (team roster drafts deleted, team deleted): status expired, temporary table
 * (everyone's names) removed. Their photos are deleted by the pending-source step.
 */
export const expireJobsNow = async (db: DbExecutor, jobIds: string[], now = new Date()): Promise<void> => {
  if (jobIds.length === 0) {
    return;
  }

  await db
    .update(recognitionJobs)
    .set({ status: RecognitionStatus.EXPIRED, tableResult: null, leaseExpiresAt: null, expiresAt: now })
    .where(inArray(recognitionJobs.id, jobIds));
};

/** Team roster drafts untouched for DRAFT_TTL_DAYS, with their upload jobs (like deleting a team). */
const deleteStaleRosterDrafts = async (db: Db, now: Date): Promise<number> => {
  const deleted = await db
    .delete(teamRosters)
    .where(
      and(
        eq(teamRosters.status, TeamRosterStatus.DRAFT),
        lte(teamRosters.updatedAt, daysBefore(now, getAppConfig().draftTtlDays)),
      ),
    )
    .returning({ id: teamRosters.id, jobId: teamRosters.sourceJobId });

  await expireJobsNow(
    db,
    deleted.flatMap((row) => (row.jobId ? [row.jobId] : [])),
    now,
  );

  return deleted.length;
};

/**
 * Spec §7.6 cleanup. Idempotent: a second run right after the first changes nothing.
 * Drafts past DRAFT_TTL are deleted whatever their status (published months keep their own snapshot).
 * Team roster sources follow the same source TTL (their jobs are ordinary recognition jobs).
 */
export const runCleanup = async (
  db: Db,
  storage: ObjectStorage,
  now = new Date(),
): Promise<CleanupResult> => {
  const result: CleanupResult = {
    expiredJobs: 0,
    sourcesDeleted: 0,
    sourceDeleteFailures: 0,
    draftsDeleted: 0,
    rateLimitCountersDeleted: 0,
    sessionsDeleted: 0,
    anonymousSessionsDeleted: 0,
    paymentsCanceled: 0,
    paymentEventsDeleted: 0,
    teamRosterDraftsDeleted: 0,
    ocrShadowRunsDeleted: 0,
  };

  // Before job expiry, so the deleted drafts' photos and tables go in this same run.
  result.teamRosterDraftsDeleted = await deleteStaleRosterDrafts(db, now);
  result.expiredJobs = await expireJobs(db, now);
  await deletePendingSources(db, storage, now, result);

  result.draftsDeleted = countDeleted(
    await db.delete(drafts).where(lte(drafts.expiresAt, now)).returning({ id: drafts.id }),
  );
  result.rateLimitCountersDeleted = countDeleted(
    await db
      .delete(rateLimitCounters)
      .where(lt(rateLimitCounters.windowStart, daysBefore(now, RATE_LIMIT_RETENTION_DAYS)))
      .returning({ key: rateLimitCounters.key }),
  );
  result.sessionsDeleted = countDeleted(
    await db.delete(sessions).where(lte(sessions.expiresAt, now)).returning({ id: sessions.id }),
  );
  result.anonymousSessionsDeleted = countDeleted(
    await db
      .delete(anonymousSessions)
      .where(lte(anonymousSessions.expiresAt, now))
      .returning({ id: anonymousSessions.id }),
  );
  result.paymentsCanceled = countDeleted(
    await db
      .update(payments)
      .set({ status: PaymentStatus.CANCELED })
      .where(
        and(
          eq(payments.status, PaymentStatus.PENDING),
          lt(payments.updatedAt, new Date(now.getTime() - STALE_PENDING_PAYMENT_HOURS * MS_PER_HOUR)),
        ),
      )
      .returning({ id: payments.id }),
  );
  // Unprocessed events are kept: they mark deliveries that still need a successful retry.
  result.paymentEventsDeleted = countDeleted(
    await db
      .delete(paymentEvents)
      .where(
        and(
          isNotNull(paymentEvents.processedAt),
          lt(paymentEvents.processedAt, daysBefore(now, PAYMENT_EVENT_RETENTION_DAYS)),
        ),
      )
      .returning({ id: paymentEvents.id }),
  );
  result.ocrShadowRunsDeleted = countDeleted(
    await db
      .delete(ocrShadowRuns)
      .where(lt(ocrShadowRuns.createdAt, daysBefore(now, OCR_SHADOW_RETENTION_DAYS)))
      .returning({ id: ocrShadowRuns.id }),
  );

  return result;
};
