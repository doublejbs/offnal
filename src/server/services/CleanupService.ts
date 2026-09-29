import { and, eq, exists, isNotNull, isNull, lt, lte, ne, or, sql } from 'drizzle-orm';

import { MS_PER_DAY, MS_PER_HOUR } from '@/domain/DomainLimits';
import { DraftStatus } from '@/domain/enums/DraftStatus';
import { PaymentStatus } from '@/domain/enums/PaymentStatus';
import { RecognitionStatus } from '@/domain/enums/RecognitionStatus';
import { type Db } from '@/server/db/Database';
import {
  anonymousSessions,
  drafts,
  payments,
  rateLimitCounters,
  type RecognitionJobRow,
  recognitionJobs,
  sessions,
} from '@/server/db/Schema';
import { type ObjectStorage } from '@/server/storage/ObjectStorage';

/** Rate-limit windows are at most a month; keep a margin. */
const RATE_LIMIT_RETENTION_DAYS = 40;
/** Checkout windows are minutes long; an order untouched for a day is abandoned. */
const STALE_PENDING_PAYMENT_HOURS = 24;
/** Per run, so one invocation stays well inside the function time limit; the next run continues. */
const JOB_BATCH_SIZE = 200;

export type CleanupResult = {
  /** Jobs past their TTL that were marked expired and/or had their temporary table removed. */
  expiredJobs: number;
  /** Source objects deleted (expired jobs + published jobs whose post-publish deletion failed). */
  sourcesDeleted: number;
  /** Deletions that failed this run; retried next run. */
  sourceDeleteFailures: number;
  draftsDeleted: number;
  rateLimitCountersDeleted: number;
  sessionsDeleted: number;
  anonymousSessionsDeleted: number;
  paymentsCanceled: number;
};

type SourceRef = {
  id: string;
  sourceObjectKey: RecognitionJobRow['sourceObjectKey'];
  sourceDeletedAt: RecognitionJobRow['sourceDeletedAt'];
};

type SourceDeletion = {
  deleted: boolean;
  failed: boolean;
};

const deleteSource = async (
  db: Db,
  storage: ObjectStorage,
  job: SourceRef,
  now: Date,
): Promise<SourceDeletion> => {
  if (!job.sourceObjectKey || job.sourceDeletedAt) {
    return { deleted: false, failed: false };
  }

  try {
    // Missing objects are a no-op in both storage drivers.
    await storage.delete(job.sourceObjectKey);
  } catch (error: unknown) {
    console.warn('[cleanup] source deletion failed', {
      name: error instanceof Error ? error.name : typeof error,
    });

    return { deleted: false, failed: true };
  }

  await db.update(recognitionJobs).set({ sourceDeletedAt: now }).where(eq(recognitionJobs.id, job.id));

  return { deleted: true, failed: false };
};

/** Past TTL: source deleted, temporary table (other people's names) removed, status expired. */
const expireJobs = async (
  db: Db,
  storage: ObjectStorage,
  now: Date,
  result: CleanupResult,
): Promise<void> => {
  const expired = await db
    .select()
    .from(recognitionJobs)
    .where(
      and(
        lte(recognitionJobs.expiresAt, now),
        or(
          ne(recognitionJobs.status, RecognitionStatus.EXPIRED),
          isNotNull(recognitionJobs.tableResult),
          and(isNotNull(recognitionJobs.sourceObjectKey), isNull(recognitionJobs.sourceDeletedAt)),
        ),
      ),
    )
    .limit(JOB_BATCH_SIZE);

  for (const job of expired) {
    const deletion = await deleteSource(db, storage, job, now);

    result.sourcesDeleted += deletion.deleted ? 1 : 0;
    result.sourceDeleteFailures += deletion.failed ? 1 : 0;

    if (job.status !== RecognitionStatus.EXPIRED || job.tableResult !== null) {
      await db
        .update(recognitionJobs)
        .set({ status: RecognitionStatus.EXPIRED, tableResult: null, leaseExpiresAt: null })
        .where(eq(recognitionJobs.id, job.id));
      result.expiredJobs += 1;
    }
  }
};

/** Publish deletes the source after commit; this retries the ones that failed. */
const retryPublishedSourceDeletion = async (
  db: Db,
  storage: ObjectStorage,
  now: Date,
  result: CleanupResult,
): Promise<void> => {
  const pending = await db
    .select({
      id: recognitionJobs.id,
      sourceObjectKey: recognitionJobs.sourceObjectKey,
      sourceDeletedAt: recognitionJobs.sourceDeletedAt,
    })
    .from(recognitionJobs)
    .where(
      and(
        isNotNull(recognitionJobs.sourceObjectKey),
        isNull(recognitionJobs.sourceDeletedAt),
        exists(
          db
            .select({ one: sql`1` })
            .from(drafts)
            .where(
              and(eq(drafts.recognitionJobId, recognitionJobs.id), eq(drafts.status, DraftStatus.PUBLISHED)),
            ),
        ),
      ),
    )
    .limit(JOB_BATCH_SIZE);

  for (const job of pending) {
    const deletion = await deleteSource(db, storage, job, now);

    result.sourcesDeleted += deletion.deleted ? 1 : 0;
    result.sourceDeleteFailures += deletion.failed ? 1 : 0;
  }
};

/**
 * Spec §7.6 cleanup. Idempotent: a second run right after the first changes nothing.
 * Drafts past DRAFT_TTL are deleted whatever their status (published months keep their own snapshot).
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
  };

  await expireJobs(db, storage, now, result);
  await retryPublishedSourceDeletion(db, storage, now, result);

  result.draftsDeleted = (
    await db.delete(drafts).where(lte(drafts.expiresAt, now)).returning({ id: drafts.id })
  ).length;
  result.rateLimitCountersDeleted = (
    await db
      .delete(rateLimitCounters)
      .where(
        lt(rateLimitCounters.windowStart, new Date(now.getTime() - RATE_LIMIT_RETENTION_DAYS * MS_PER_DAY)),
      )
      .returning({ key: rateLimitCounters.key })
  ).length;
  result.sessionsDeleted = (
    await db.delete(sessions).where(lte(sessions.expiresAt, now)).returning({ id: sessions.id })
  ).length;
  result.anonymousSessionsDeleted = (
    await db
      .delete(anonymousSessions)
      .where(lte(anonymousSessions.expiresAt, now))
      .returning({ id: anonymousSessions.id })
  ).length;
  result.paymentsCanceled = (
    await db
      .update(payments)
      .set({ status: PaymentStatus.CANCELED })
      .where(
        and(
          eq(payments.status, PaymentStatus.PENDING),
          lt(payments.updatedAt, new Date(now.getTime() - STALE_PENDING_PAYMENT_HOURS * MS_PER_HOUR)),
        ),
      )
      .returning({ id: payments.id })
  ).length;

  return result;
};
