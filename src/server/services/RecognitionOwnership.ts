import 'server-only';

import { and, eq, gt, isNull, notExists, or, type SQL, sql } from 'drizzle-orm';

import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { RecognitionErrorCode } from '@/domain/enums/RecognitionErrorCode';
import { RecognitionStatus } from '@/domain/enums/RecognitionStatus';
import { type RecognitionStatusResponse } from '@/domain/types/api/RecognitionStatusResponse';
import { type DbExecutor } from '@/server/db/Database';
import { type RecognitionJobRow, recognitionJobs, teamRosters } from '@/server/db/Schema';
import { ApiError } from '@/server/errors/ApiError';
import { type LoggedInContext, type RequestContext } from '@/server/http/RequestContext';
import { requireUser, requireUuid } from '@/server/validation/RequestGuards';

export const MAX_RECOGNITION_ATTEMPTS = 3;

/** Failures a user may retry with the same photo. Missing configuration/source cannot be fixed by retrying. */
export const RETRYABLE_ERROR_CODES: RecognitionErrorCode[] = [
  RecognitionErrorCode.NO_TABLE,
  RecognitionErrorCode.UNREADABLE,
  RecognitionErrorCode.MONTH_NOT_FOUND,
  RecognitionErrorCode.NO_NAMES,
  RecognitionErrorCode.PROVIDER_ERROR,
  RecognitionErrorCode.PROVIDER_TIMEOUT,
];

export const isJobExpired = (job: RecognitionJobRow, now: Date): boolean =>
  job.status === RecognitionStatus.EXPIRED || job.expiresAt.getTime() <= now.getTime();

export const isJobRetryable = (job: RecognitionJobRow): boolean =>
  job.status === RecognitionStatus.FAILED &&
  job.errorCode !== null &&
  RETRYABLE_ERROR_CODES.includes(job.errorCode) &&
  job.attemptCount < MAX_RECOGNITION_ATTEMPTS;

export const isSourceAvailable = (job: RecognitionJobRow | null | undefined, now = new Date()): boolean =>
  Boolean(job && job.sourceObjectKey && job.sourceDeletedAt === null && !isJobExpired(job, now));

/** Status only: no names, codes or year-month (safe before login). */
export const toStatusResponse = (
  job: RecognitionJobRow,
  context: RequestContext,
  now = new Date(),
): RecognitionStatusResponse => {
  const expired = isJobExpired(job, now);

  return {
    id: job.id,
    status: expired ? RecognitionStatus.EXPIRED : job.status,
    errorCode: expired ? null : job.errorCode,
    retryable: !expired && isJobRetryable(job),
    expiresAt: job.expiresAt.toISOString(),
    ownerAuthenticated: context.user !== null,
  };
};

/** Owner = the current user, or (unclaimed and) the current anonymous session. Never the job ID alone. */
const buildOwnershipCondition = (context: RequestContext): SQL | undefined => {
  const anonymousCondition = context.anonymousSessionId
    ? and(isNull(recognitionJobs.userId), eq(recognitionJobs.anonymousSessionId, context.anonymousSessionId))
    : undefined;
  const userCondition = context.user ? eq(recognitionJobs.userId, context.user.id) : undefined;

  if (userCondition && anonymousCondition) {
    return or(userCondition, anonymousCondition);
  }

  return userCondition ?? anonymousCondition;
};

/** Mismatch and absence are both 404 so job existence is never revealed. */
export const findOwnedJob = async (
  db: DbExecutor,
  context: RequestContext,
  jobId: string,
): Promise<RecognitionJobRow> => {
  const ownership = buildOwnershipCondition(context);

  if (!ownership) {
    throw new ApiError(ApiErrorCode.NOT_FOUND);
  }

  const [job] = await db
    .select()
    .from(recognitionJobs)
    .where(
      and(
        eq(recognitionJobs.id, requireUuid(jobId)),
        ownership,
        // Team roster uploads are reachable only through the team roster API (admins of that team).
        notExists(
          db
            .select({ one: sql`1` })
            .from(teamRosters)
            .where(eq(teamRosters.sourceJobId, recognitionJobs.id)),
        ),
      ),
    )
    .limit(1);

  if (!job) {
    throw new ApiError(ApiErrorCode.NOT_FOUND);
  }

  return job;
};

/** Links unexpired, unclaimed jobs of the anonymous session to the user (conditional UPDATE). */
export const claimAnonymousJobs = async (
  db: DbExecutor,
  userId: string,
  anonymousSessionId: string,
  now = new Date(),
): Promise<number> => {
  const claimed = await db
    .update(recognitionJobs)
    .set({ userId })
    .where(
      and(
        eq(recognitionJobs.anonymousSessionId, anonymousSessionId),
        isNull(recognitionJobs.userId),
        gt(recognitionJobs.expiresAt, now),
      ),
    )
    .returning({ id: recognitionJobs.id });

  return claimed.length;
};

/** Spec §6 conditions in one conditional UPDATE: same anonymous session, unexpired, unclaimed or already ours. */
const claimJobForUser = async (
  db: DbExecutor,
  context: LoggedInContext,
  jobId: string,
  now: Date,
): Promise<RecognitionJobRow | null> => {
  if (!context.anonymousSessionId) {
    return null;
  }

  const [claimed] = await db
    .update(recognitionJobs)
    .set({ userId: context.user.id })
    .where(
      and(
        eq(recognitionJobs.id, jobId),
        eq(recognitionJobs.anonymousSessionId, context.anonymousSessionId),
        gt(recognitionJobs.expiresAt, now),
        or(isNull(recognitionJobs.userId), eq(recognitionJobs.userId, context.user.id)),
      ),
    )
    .returning();

  return claimed ?? null;
};

/** Already owned by this user → same success; another user's or foreign session's job → 404. */
export const claimRecognition = async (
  db: DbExecutor,
  context: RequestContext,
  jobId: string,
): Promise<RecognitionStatusResponse> => {
  const loggedIn = requireUser(context);
  const now = new Date();
  const claimed = await claimJobForUser(db, loggedIn, requireUuid(jobId), now);

  return toStatusResponse(claimed ?? (await findOwnedJob(db, loggedIn, jobId)), loggedIn, now);
};

/** Logged-in owner only. An unclaimed job of the current anonymous session is claimed on the way. */
export const requireLoggedInOwnedJob = async (
  db: DbExecutor,
  context: RequestContext,
  jobId: string,
): Promise<{ context: LoggedInContext; job: RecognitionJobRow }> => {
  const loggedIn = requireUser(context);
  const now = new Date();
  const found = await findOwnedJob(db, loggedIn, jobId);

  if (isJobExpired(found, now)) {
    throw new ApiError(ApiErrorCode.EXPIRED);
  }

  const job = found.userId === null ? await claimJobForUser(db, loggedIn, found.id, now) : found;

  if (!job) {
    throw new ApiError(ApiErrorCode.NOT_FOUND);
  }

  return { context: loggedIn, job };
};
