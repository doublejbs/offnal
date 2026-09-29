import { randomUUID } from 'node:crypto';

import { and, eq, gt, inArray, isNull, lt, or, type SQL, sql } from 'drizzle-orm';

import { AnalyticsEvent } from '@/domain/enums/AnalyticsEvent';
import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { DraftStatus } from '@/domain/enums/DraftStatus';
import { type ImageMimeType } from '@/domain/enums/ImageMimeType';
import { RecognitionErrorCode } from '@/domain/enums/RecognitionErrorCode';
import { RecognitionStatus } from '@/domain/enums/RecognitionStatus';
import { normalizeExtraction } from '@/domain/ScheduleValidator';
import { type CandidatesResponse } from '@/domain/types/api/CandidatesResponse';
import { type CreateRecognitionResponse } from '@/domain/types/api/CreateRecognitionResponse';
import { type ExtractRecognitionRequest } from '@/domain/types/api/ExtractRecognitionRequest';
import { type ExtractRecognitionResponse } from '@/domain/types/api/ExtractRecognitionResponse';
import { type RecognitionStatusResponse } from '@/domain/types/api/RecognitionStatusResponse';
import { type NormalizedSchedule } from '@/domain/types/NormalizedSchedule';
import { type TableRecognition } from '@/domain/types/TableRecognition';
import { type TableRecognitionResult } from '@/domain/types/TableRecognitionResult';
import { track } from '@/server/analytics/Analytics';
import { getAppConfig } from '@/server/config/AppConfig';
import { type Db, type DbExecutor } from '@/server/db/Database';
import { drafts, type RecognitionJobRow, recognitionJobs, users } from '@/server/db/Schema';
import { ApiError } from '@/server/http/ApiError';
import { type LoggedInContext, type RequestContext, requireUser } from '@/server/http/RequestContext';
import { requireUuid } from '@/server/http/RouteHelpers';
import { enforceExtractLimit } from '@/server/services/RateLimitService';
import { buildSourceObjectKey } from '@/server/storage/ObjectStorage';
import { getObjectStorage } from '@/server/storage/StorageFactory';
import { getVisionProvider } from '@/server/vision/VisionFactory';
import { toRecognitionErrorCode, VisionProviderError } from '@/server/vision/VisionProvider';

export const MAX_RECOGNITION_ATTEMPTS = 3;

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;
/** Extra lease time beyond the provider timeout so a slow finish is not taken over mid-write. */
const LEASE_GRACE_MS = 30_000;
const MAX_DISPLAY_NAME_LENGTH = 40;

/** Failures a user may retry with the same photo. Missing configuration/source cannot be fixed by retrying. */
const RETRYABLE_ERROR_CODES: RecognitionErrorCode[] = [
  RecognitionErrorCode.NO_TABLE,
  RecognitionErrorCode.UNREADABLE,
  RecognitionErrorCode.MONTH_NOT_FOUND,
  RecognitionErrorCode.NO_NAMES,
  RecognitionErrorCode.PROVIDER_ERROR,
  RecognitionErrorCode.PROVIDER_TIMEOUT,
];

const isJobExpired = (job: RecognitionJobRow, now: Date): boolean =>
  job.status === RecognitionStatus.EXPIRED || job.expiresAt.getTime() <= now.getTime();

const isRetryable = (job: RecognitionJobRow): boolean =>
  job.status === RecognitionStatus.FAILED &&
  job.errorCode !== null &&
  RETRYABLE_ERROR_CODES.includes(job.errorCode) &&
  job.attemptCount < MAX_RECOGNITION_ATTEMPTS;

export const isSourceAvailable = (job: RecognitionJobRow | null | undefined, now = new Date()): boolean =>
  Boolean(job && job.sourceObjectKey && job.sourceDeletedAt === null && !isJobExpired(job, now));

/** Status only: no names, codes or year-month (safe before login). */
const toStatusResponse = (
  job: RecognitionJobRow,
  context: RequestContext,
  now: Date,
): RecognitionStatusResponse => {
  const expired = isJobExpired(job, now);

  return {
    id: job.id,
    status: expired ? RecognitionStatus.EXPIRED : job.status,
    errorCode: expired ? null : job.errorCode,
    retryable: !expired && isRetryable(job),
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
    .where(and(eq(recognitionJobs.id, requireUuid(jobId)), ownership))
    .limit(1);

  if (!job) {
    throw new ApiError(ApiErrorCode.NOT_FOUND);
  }

  return job;
};

export type CreateRecognitionInput = {
  userId: string | null;
  anonymousSessionId: string | null;
  bytes: Buffer;
  mime: ImageMimeType;
};

/** Stores the source privately at `sources/{jobId}` and creates an `uploaded` job owned by the user or session. */
export const createRecognitionJob = async (
  db: DbExecutor,
  input: CreateRecognitionInput,
  now = new Date(),
): Promise<CreateRecognitionResponse> => {
  const id = randomUUID();
  const sourceObjectKey = buildSourceObjectKey(id);

  await getObjectStorage().put(sourceObjectKey, input.bytes, input.mime);
  await db.insert(recognitionJobs).values({
    id,
    userId: input.userId,
    anonymousSessionId: input.userId ? null : input.anonymousSessionId,
    status: RecognitionStatus.UPLOADED,
    sourceObjectKey,
    sourceMime: input.mime,
    expiresAt: new Date(now.getTime() + getAppConfig().sourceTtlHours * MS_PER_HOUR),
  });
  track(AnalyticsEvent.UPLOAD_STARTED);

  return { id };
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
  if (!result.ok) {
    return result;
  }

  if (result.value.candidates.length === 0) {
    return { ok: false, errorCode: RecognitionErrorCode.NO_NAMES };
  }

  return result;
};

const readSourceBytes = async (job: RecognitionJobRow): Promise<Buffer | null> => {
  if (!job.sourceObjectKey || job.sourceDeletedAt !== null) {
    return null;
  }

  return getObjectStorage().get(job.sourceObjectKey);
};

const runTableRecognition = async (job: RecognitionJobRow): Promise<TableRecognitionResult> => {
  const bytes = await readSourceBytes(job);

  if (!bytes) {
    return { ok: false, errorCode: RecognitionErrorCode.SOURCE_MISSING };
  }

  const signal = AbortSignal.timeout(getAppConfig().visionTimeoutMs);

  try {
    const result = await getVisionProvider().recognizeTable(
      { bytes, mime: job.sourceMime as ImageMimeType },
      signal,
    );

    return validateTableRecognition(result);
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
    return toStatusResponse(await findOwnedJob(db, context, jobId), context, new Date());
  }

  let result: TableRecognitionResult;

  try {
    result = await runTableRecognition(leased);
  } catch {
    result = { ok: false, errorCode: RecognitionErrorCode.PROVIDER_ERROR };
  }

  const finished = await finishAttempt(db, leased, result);

  track(AnalyticsEvent.RECOGNITION_COMPLETED, { success: result.ok, attempt: leased.attemptCount });

  return toStatusResponse(finished ?? (await findOwnedJob(db, context, jobId)), context, new Date());
};

export const getRecognitionStatus = async (
  db: DbExecutor,
  context: RequestContext,
  jobId: string,
): Promise<RecognitionStatusResponse> =>
  toStatusResponse(await findOwnedJob(db, context, jobId), context, new Date());

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

const claimJob = async (
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

/** Spec §6 claim. Already owned by this user → same success; another user's or foreign session's job → 404. */
export const claimRecognition = async (
  db: DbExecutor,
  context: RequestContext,
  jobId: string,
): Promise<RecognitionStatusResponse> => {
  const loggedIn = requireUser(context);
  const now = new Date();
  const claimed = await claimJob(db, loggedIn, requireUuid(jobId), now);

  return toStatusResponse(claimed ?? (await findOwnedJob(db, loggedIn, jobId)), loggedIn, now);
};

/** Logged-in owner only. An unclaimed job of the current anonymous session is claimed on the way. */
const requireLoggedInOwnedJob = async (
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

  const job = found.userId === null ? await claimJob(db, loggedIn, found.id, now) : found;

  if (!job) {
    throw new ApiError(ApiErrorCode.NOT_FOUND);
  }

  return { context: loggedIn, job };
};

const requireTableResult = (job: RecognitionJobRow): TableRecognition => {
  if (job.status !== RecognitionStatus.RECOGNIZED || !job.tableResult) {
    throw new ApiError(ApiErrorCode.RECOGNITION_NOT_READY);
  }

  return job.tableResult;
};

export const getCandidates = async (
  db: DbExecutor,
  context: RequestContext,
  jobId: string,
): Promise<CandidatesResponse> => {
  const { job } = await requireLoggedInOwnedJob(db, context, jobId);
  const table = requireTableResult(job);

  return {
    yearMonthGuess: table.yearMonth,
    candidates: table.candidates,
    definitions: table.definitions,
    dayHeaders: table.dayHeaders,
    sourceAvailable: isSourceAvailable(job),
  };
};

export type SourceImage = {
  bytes: Buffer;
  mime: string;
};

const SOURCE_GONE_MESSAGE = '원본 사진이 삭제되었거나 보관 기간이 지났어요.';

export const readSourceImage = async (
  db: DbExecutor,
  context: RequestContext,
  jobId: string,
): Promise<SourceImage> => {
  const { job } = await requireLoggedInOwnedJob(db, context, jobId);
  const bytes = isSourceAvailable(job) ? await readSourceBytes(job) : null;

  if (!bytes) {
    throw new ApiError(ApiErrorCode.EXPIRED, { message: SOURCE_GONE_MESSAGE });
  }

  return { bytes, mime: job.sourceMime };
};

const buildDraftExpiry = (now: Date): Date =>
  new Date(now.getTime() + getAppConfig().draftTtlDays * MS_PER_DAY);

const toProviderApiError = (error: unknown, signal: AbortSignal): ApiError => {
  const code = error instanceof VisionProviderError ? error.errorCode : toRecognitionErrorCode(error, signal);

  if (code === RecognitionErrorCode.PROVIDER_NOT_CONFIGURED) {
    return new ApiError(ApiErrorCode.PROVIDER_NOT_CONFIGURED);
  }

  return new ApiError(ApiErrorCode.PROVIDER_ERROR, { details: { reason: code } });
};

const extractPersonSchedule = async (
  job: RecognitionJobRow,
  table: TableRecognition,
  rowId: string,
  name: string,
  yearMonth: string,
): Promise<NormalizedSchedule> => {
  const bytes = isSourceAvailable(job) ? await readSourceBytes(job) : null;

  if (!bytes) {
    throw new ApiError(ApiErrorCode.EXPIRED, { message: SOURCE_GONE_MESSAGE });
  }

  const signal = AbortSignal.timeout(getAppConfig().visionTimeoutMs);

  try {
    const extraction = await getVisionProvider().extractPerson(
      { bytes, mime: job.sourceMime as ImageMimeType },
      { rowId, name, yearMonth, definitions: table.definitions },
      signal,
    );

    return normalizeExtraction(extraction, yearMonth);
  } catch (error: unknown) {
    throw toProviderApiError(error, signal);
  }
};

const extractRowDraft = async (
  db: Db,
  context: LoggedInContext,
  job: RecognitionJobRow,
  table: TableRecognition,
  rowId: string,
  yearMonth: string,
): Promise<ExtractRecognitionResponse> => {
  const candidate = table.candidates.find((item) => item.rowId === rowId);

  if (!candidate) {
    throw new ApiError(ApiErrorCode.VALIDATION_ERROR, { message: '선택한 이름을 찾을 수 없어요.' });
  }

  const identity = and(
    eq(drafts.recognitionJobId, job.id),
    eq(drafts.personRowId, rowId),
    eq(drafts.yearMonth, yearMonth),
  );
  const [existing] = await db.select().from(drafts).where(identity).limit(1);

  if (existing && existing.status !== DraftStatus.DISCARDED) {
    return { draftId: existing.id };
  }

  await enforceExtractLimit(db, context.user.id);

  const schedule = await extractPersonSchedule(job, table, rowId, candidate.name, yearMonth);
  const now = new Date();

  if (existing) {
    // A discarded draft occupies the (job, row, month) key: start it over as a fresh editing draft.
    await db.delete(drafts).where(and(eq(drafts.id, existing.id), eq(drafts.status, DraftStatus.DISCARDED)));
  }

  const [inserted] = await db
    .insert(drafts)
    .values({
      userId: context.user.id,
      recognitionJobId: job.id,
      personRowId: rowId,
      yearMonth,
      displayName: candidate.name.slice(0, MAX_DISPLAY_NAME_LENGTH),
      definitions: schedule.definitions,
      entries: schedule.entries,
      sourceCells: schedule.sourceCells,
      status: DraftStatus.EDITING,
      expiresAt: buildDraftExpiry(now),
    })
    .onConflictDoNothing()
    .returning({ id: drafts.id });

  if (inserted) {
    return { draftId: inserted.id };
  }

  const [winner] = await db.select({ id: drafts.id }).from(drafts).where(identity).limit(1);

  if (!winner) {
    throw new Error('Draft insert conflict without an existing draft');
  }

  return { draftId: winner.id };
};

/** Name not in the candidates: empty draft (all dates MISSING_DATE) with the first-pass code legend. */
const extractManualDraft = async (
  db: Db,
  context: LoggedInContext,
  job: RecognitionJobRow,
  table: TableRecognition,
  manualName: string,
  yearMonth: string,
): Promise<ExtractRecognitionResponse> =>
  db.transaction(async (tx) => {
    // Serializes concurrent manual extracts of the same user (the unique index ignores null rows).
    await tx.select({ id: users.id }).from(users).where(eq(users.id, context.user.id)).for('update');

    const [existing] = await tx
      .select({ id: drafts.id })
      .from(drafts)
      .where(
        and(
          eq(drafts.recognitionJobId, job.id),
          isNull(drafts.personRowId),
          eq(drafts.yearMonth, yearMonth),
          eq(drafts.displayName, manualName),
          eq(drafts.status, DraftStatus.EDITING),
        ),
      )
      .limit(1);

    if (existing) {
      return { draftId: existing.id };
    }

    const schedule = normalizeExtraction(
      { yearMonth, rowId: '', displayName: manualName, definitions: table.definitions, cells: [] },
      yearMonth,
    );
    const [inserted] = await tx
      .insert(drafts)
      .values({
        userId: context.user.id,
        recognitionJobId: job.id,
        personRowId: null,
        yearMonth,
        displayName: manualName,
        definitions: schedule.definitions,
        entries: schedule.entries,
        sourceCells: schedule.sourceCells,
        status: DraftStatus.EDITING,
        expiresAt: buildDraftExpiry(new Date()),
      })
      .returning({ id: drafts.id });

    if (!inserted) {
      throw new Error('Draft insert returned no row');
    }

    return { draftId: inserted.id };
  });

/** Second pass → personal draft. Idempotent per (job, row, month) and per (job, manual name, month). */
export const extractDraft = async (
  db: Db,
  context: RequestContext,
  jobId: string,
  input: ExtractRecognitionRequest,
): Promise<ExtractRecognitionResponse> => {
  const { context: loggedIn, job } = await requireLoggedInOwnedJob(db, context, jobId);
  const table = requireTableResult(job);

  if ('rowId' in input) {
    return extractRowDraft(db, loggedIn, job, table, input.rowId, input.yearMonth);
  }

  return extractManualDraft(db, loggedIn, job, table, input.manualName, input.yearMonth);
};
