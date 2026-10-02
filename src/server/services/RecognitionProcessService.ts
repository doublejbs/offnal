import 'server-only';

import { randomUUID } from 'node:crypto';

import { and, eq, gt, inArray, lt, or, sql } from 'drizzle-orm';

import { LEASE_GRACE_MS, MS_PER_HOUR } from '@/domain/DomainLimits';
import { AnalyticsEvent } from '@/domain/enums/AnalyticsEvent';
import { type ImageMimeType } from '@/domain/enums/ImageMimeType';
import { RecognitionErrorCode } from '@/domain/enums/RecognitionErrorCode';
import { RecognitionStatus } from '@/domain/enums/RecognitionStatus';
import { type RecognitionStatusResponse } from '@/domain/types/api/RecognitionStatusResponse';
import { type TableRecognitionResult } from '@/domain/types/TableRecognitionResult';
import { track } from '@/server/analytics/Analytics';
import { createAnonymousSession, type IssuedToken } from '@/server/auth/SessionService';
import { getAppConfig } from '@/server/config/AppConfig';
import { type Db, type DbExecutor, type DbTransaction } from '@/server/db/Database';
import { type RecognitionJobRow, recognitionJobs } from '@/server/db/Schema';
import { type RequestContext } from '@/server/http/RequestContext';
import { countNewAnonymousUpload } from '@/server/services/RateLimitService';
import {
  findOwnedJob,
  isJobExpired,
  MAX_RECOGNITION_ATTEMPTS,
  RETRYABLE_ERROR_CODES,
  toStatusResponse,
} from '@/server/services/RecognitionOwnership';
import { buildSourceObjectKey } from '@/server/storage/ObjectStorage';
import { getObjectStorage } from '@/server/storage/StorageFactory';
import { getVisionProvider } from '@/server/vision/VisionFactory';
import { prepareImageForVision } from '@/server/vision/VisionImagePreparer';
import { toRecognitionErrorCode, type VisionImage } from '@/server/vision/VisionProvider';

const describeError = (error: unknown): string => (error instanceof Error ? error.name : typeof error);

export type CreateRecognitionInput = {
  userId: string | null;
  /** Current anonymous session, if any. */
  anonymousSessionId: string | null;
  /** IP hash for a new anonymous session when the visitor has neither a user nor a session. */
  ipHash: string;
  bytes: Buffer;
  mime: ImageMimeType;
};

export type CreatedRecognition = {
  id: string;
  /** Set when this request created the visitor's anonymous session (route sets the cookie). */
  issuedAnonymousSession: IssuedToken | null;
};

export type StoredSource = {
  jobId: string;
  sourceObjectKey: string;
};

export type UploadedJobInput = {
  userId: string | null;
  anonymousSessionId: string | null;
  mime: ImageMimeType;
};

/** The `uploaded` job row for a stored source (inside the caller's transaction). */
export const insertUploadedJob = async (
  tx: DbExecutor,
  source: StoredSource,
  input: UploadedJobInput,
  now = new Date(),
): Promise<void> => {
  await tx.insert(recognitionJobs).values({
    id: source.jobId,
    userId: input.userId,
    anonymousSessionId: input.userId ? null : input.anonymousSessionId,
    status: RecognitionStatus.UPLOADED,
    sourceObjectKey: source.sourceObjectKey,
    sourceMime: input.mime,
    expiresAt: new Date(now.getTime() + getAppConfig().sourceTtlHours * MS_PER_HOUR),
  });
};

/**
 * Stores the source privately at `sources/{jobId}` (outside any transaction), then runs `write` in one
 * transaction that must insert the job (and whatever belongs with it). If the DB step fails, the stored
 * object is deleted, so no orphan source or half-created upload remains.
 */
export const withStoredSource = async <T>(
  db: Db,
  bytes: Buffer,
  mime: ImageMimeType,
  write: (tx: DbTransaction, source: StoredSource) => Promise<T>,
): Promise<T> => {
  const jobId = randomUUID();
  const source = { jobId, sourceObjectKey: buildSourceObjectKey(jobId) };
  const storage = getObjectStorage();

  await storage.put(source.sourceObjectKey, bytes, mime);

  try {
    const result = await db.transaction((tx) => write(tx, source));

    track(AnalyticsEvent.UPLOAD_STARTED);

    return result;
  } catch (error: unknown) {
    await storage.delete(source.sourceObjectKey).catch((deleteError: unknown) => {
      console.warn('[recognition] orphan source cleanup failed', { name: describeError(deleteError) });
    });

    throw error;
  }
};

/**
 * Personal upload: the source, then (in one transaction) the anonymous session if needed and the job.
 */
export const createRecognitionJob = async (
  db: Db,
  input: CreateRecognitionInput,
  now = new Date(),
): Promise<CreatedRecognition> =>
  withStoredSource(db, input.bytes, input.mime, async (tx, source) => {
    let anonymousSessionId = input.anonymousSessionId;
    let issued: IssuedToken | null = null;

    if (!input.userId && !anonymousSessionId) {
      issued = await createAnonymousSession(tx, input.ipHash, now);
      anonymousSessionId = issued.id;
      await countNewAnonymousUpload(tx, anonymousSessionId);
    }

    await insertUploadedJob(tx, source, { userId: input.userId, anonymousSessionId, mime: input.mime }, now);

    return { id: source.jobId, issuedAnonymousSession: issued };
  });

/** Atomic lease: only one caller may move the job into `processing` for a given attempt. */
const acquireLease = async (db: DbExecutor, jobId: string, now: Date): Promise<RecognitionJobRow | null> => {
  const leaseExpiresAt = new Date(now.getTime() + getAppConfig().visionTimeoutMs + LEASE_GRACE_MS);
  const [leased] = await db
    .update(recognitionJobs)
    .set({
      status: RecognitionStatus.PROCESSING,
      attemptCount: sql`${recognitionJobs.attemptCount} + 1`,
      leaseExpiresAt,
      errorCode: null,
    })
    .where(
      and(
        eq(recognitionJobs.id, jobId),
        gt(recognitionJobs.expiresAt, now),
        or(
          eq(recognitionJobs.status, RecognitionStatus.UPLOADED),
          and(
            eq(recognitionJobs.status, RecognitionStatus.PROCESSING),
            lt(recognitionJobs.leaseExpiresAt, now),
          ),
          and(
            eq(recognitionJobs.status, RecognitionStatus.FAILED),
            inArray(recognitionJobs.errorCode, RETRYABLE_ERROR_CODES),
            lt(recognitionJobs.attemptCount, MAX_RECOGNITION_ATTEMPTS),
          ),
        ),
      ),
    )
    .returning();

  return leased ?? null;
};

/** Server-side re-validation of the provider result. */
const validateTableRecognition = (result: TableRecognitionResult): TableRecognitionResult => {
  if (result.ok && result.value.candidates.length === 0) {
    return { ok: false, errorCode: RecognitionErrorCode.NO_NAMES };
  }

  return result;
};

/** Reads the stored source (null when deleted/missing). Storage errors propagate. */
export const readSourceBytes = async (job: RecognitionJobRow): Promise<Buffer | null> => {
  if (!job.sourceObjectKey || job.sourceDeletedAt !== null) {
    return null;
  }

  return getObjectStorage().get(job.sourceObjectKey);
};

/** `bytes` is the original upload (memory only), kept for the AI-free shadow reader (Spec §21). */
type PreparedSource =
  { ok: true; image: VisionImage; bytes: Buffer } | { ok: false; errorCode: RecognitionErrorCode };

/** Loads the source and downscales a provider copy. Errors are logged by name only. */
export const loadSourceForVision = async (job: RecognitionJobRow): Promise<PreparedSource> => {
  let bytes: Buffer | null;

  try {
    bytes = await readSourceBytes(job);
  } catch (error: unknown) {
    console.warn('[recognition] source read failed', { name: describeError(error) });

    return { ok: false, errorCode: RecognitionErrorCode.PROVIDER_ERROR };
  }

  if (!bytes) {
    return { ok: false, errorCode: RecognitionErrorCode.SOURCE_MISSING };
  }

  try {
    return { ok: true, image: await prepareImageForVision(bytes), bytes };
  } catch (error: unknown) {
    console.warn('[recognition] source preparation failed', { name: describeError(error) });

    return { ok: false, errorCode: RecognitionErrorCode.UNREADABLE };
  }
};

const runTableRecognition = async (job: RecognitionJobRow): Promise<TableRecognitionResult> => {
  const source = await loadSourceForVision(job);

  if (!source.ok) {
    return source;
  }

  const signal = AbortSignal.timeout(getAppConfig().visionTimeoutMs);

  try {
    return validateTableRecognition(await getVisionProvider().recognizeTable(source.image, signal));
  } catch (error: unknown) {
    return { ok: false, errorCode: toRecognitionErrorCode(error, signal) };
  }
};

const finishAttempt = async (
  db: DbExecutor,
  leased: RecognitionJobRow,
  result: TableRecognitionResult,
): Promise<RecognitionJobRow | null> => {
  const [finished] = await db
    .update(recognitionJobs)
    .set(
      result.ok
        ? {
            status: RecognitionStatus.RECOGNIZED,
            errorCode: null,
            tableResult: result.value,
            leaseExpiresAt: null,
          }
        : {
            status: RecognitionStatus.FAILED,
            errorCode: result.errorCode,
            tableResult: null,
            leaseExpiresAt: null,
          },
    )
    .where(
      and(
        eq(recognitionJobs.id, leased.id),
        eq(recognitionJobs.status, RecognitionStatus.PROCESSING),
        eq(recognitionJobs.attemptCount, leased.attemptCount),
      ),
    )
    .returning();

  return finished ?? null;
};

/**
 * Runs the first recognition pass synchronously (no background promise). Callers without the lease
 * get the current status back, so repeated/concurrent calls are idempotent.
 */
export const processRecognition = async (
  db: Db,
  context: RequestContext,
  jobId: string,
): Promise<RecognitionStatusResponse> => {
  const job = await findOwnedJob(db, context, jobId);
  const finished = await runRecognitionForJob(db, job);

  return toStatusResponse(finished ?? (await findOwnedJob(db, context, jobId)), context);
};

/**
 * First pass for an already authorized job (personal: owner checked; team roster: admin checked). Returns
 * the finished job, or null when another caller holds the lease / the job expired (callers re-read it).
 */
export const runRecognitionForJob = async (
  db: Db,
  job: RecognitionJobRow,
): Promise<RecognitionJobRow | null> => {
  const leased = isJobExpired(job, new Date()) ? null : await acquireLease(db, job.id, new Date());

  if (!leased) {
    return null;
  }

  const result = await runTableRecognition(leased);
  const finished = await finishAttempt(db, leased, result);

  track(AnalyticsEvent.RECOGNITION_COMPLETED, { success: result.ok, attempt: leased.attemptCount });

  return finished;
};

export const getRecognitionStatus = async (
  db: DbExecutor,
  context: RequestContext,
  jobId: string,
): Promise<RecognitionStatusResponse> => toStatusResponse(await findOwnedJob(db, context, jobId), context);
