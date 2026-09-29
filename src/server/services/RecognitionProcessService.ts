import 'server-only';

import { randomUUID } from 'node:crypto';

import { and, eq, gt, inArray, lt, or, sql } from 'drizzle-orm';

import { MS_PER_HOUR } from '@/domain/DomainLimits';
import { AnalyticsEvent } from '@/domain/enums/AnalyticsEvent';
import { type ImageMimeType } from '@/domain/enums/ImageMimeType';
import { RecognitionErrorCode } from '@/domain/enums/RecognitionErrorCode';
import { RecognitionStatus } from '@/domain/enums/RecognitionStatus';
import { type RecognitionStatusResponse } from '@/domain/types/api/RecognitionStatusResponse';
import { type TableRecognitionResult } from '@/domain/types/TableRecognitionResult';
import { track } from '@/server/analytics/Analytics';
import { createAnonymousSession, type IssuedToken } from '@/server/auth/SessionService';
import { getAppConfig } from '@/server/config/AppConfig';
import { type Db, type DbExecutor } from '@/server/db/Database';
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

/** Extra lease time beyond the provider timeout so a slow finish is not taken over mid-write. */
const LEASE_GRACE_MS = 30_000;

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

/**
 * Stores the source privately at `sources/{jobId}`, then creates (in one transaction) the anonymous
 * session if needed and the `uploaded` job. If the DB step fails, the stored object is deleted.
 */
export const createRecognitionJob = async (
  db: Db,
  input: CreateRecognitionInput,
  now = new Date(),
): Promise<CreatedRecognition> => {
  const id = randomUUID();
  const sourceObjectKey = buildSourceObjectKey(id);
  const storage = getObjectStorage();

  await storage.put(sourceObjectKey, input.bytes, input.mime);

  try {
    const issuedAnonymousSession = await db.transaction(async (tx) => {
      let anonymousSessionId = input.anonymousSessionId;
      let issued: IssuedToken | null = null;

      if (!input.userId && !anonymousSessionId) {
        issued = await createAnonymousSession(tx, input.ipHash, now);
        anonymousSessionId = issued.id;
        await countNewAnonymousUpload(tx, anonymousSessionId);
      }

      await tx.insert(recognitionJobs).values({
        id,
        userId: input.userId,
        anonymousSessionId: input.userId ? null : anonymousSessionId,
        status: RecognitionStatus.UPLOADED,
        sourceObjectKey,
        sourceMime: input.mime,
        expiresAt: new Date(now.getTime() + getAppConfig().sourceTtlHours * MS_PER_HOUR),
      });

      return issued;
    });

    track(AnalyticsEvent.UPLOAD_STARTED);

    return { id, issuedAnonymousSession };
  } catch (error: unknown) {
    await storage.delete(sourceObjectKey).catch((deleteError: unknown) => {
      console.warn('[recognition] orphan source cleanup failed', { name: describeError(deleteError) });
    });

    throw error;
  }
};

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

type PreparedSource = { ok: true; image: VisionImage } | { ok: false; errorCode: RecognitionErrorCode };

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
    return { ok: true, image: await prepareImageForVision(bytes) };
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
  const leased = isJobExpired(job, new Date()) ? null : await acquireLease(db, job.id, new Date());

  if (!leased) {
    return toStatusResponse(await findOwnedJob(db, context, jobId), context);
  }

  const result = await runTableRecognition(leased);
  const finished = await finishAttempt(db, leased, result);

  track(AnalyticsEvent.RECOGNITION_COMPLETED, { success: result.ok, attempt: leased.attemptCount });

  return toStatusResponse(finished ?? (await findOwnedJob(db, context, jobId)), context);
};

export const getRecognitionStatus = async (
  db: DbExecutor,
  context: RequestContext,
  jobId: string,
): Promise<RecognitionStatusResponse> => toStatusResponse(await findOwnedJob(db, context, jobId), context);
