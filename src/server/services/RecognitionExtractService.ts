import 'server-only';

import { and, eq, isNull } from 'drizzle-orm';

import { countReviewEntries, countUnresolvedEntries } from '@/domain/DraftReviewStats';
import { AnalyticsEvent } from '@/domain/enums/AnalyticsEvent';
import { AnalyticsSubjectKind } from '@/domain/enums/AnalyticsSubjectKind';
import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { DraftStatus } from '@/domain/enums/DraftStatus';
import { RecognitionStatus } from '@/domain/enums/RecognitionStatus';
import { normalizeExtraction } from '@/domain/ScheduleValidator';
import { type CandidatesResponse } from '@/domain/types/api/CandidatesResponse';
import { type ExtractRecognitionRequest } from '@/domain/types/api/ExtractRecognitionRequest';
import { type ExtractRecognitionResponse } from '@/domain/types/api/ExtractRecognitionResponse';
import { type ShiftEntry } from '@/domain/types/ShiftEntry';
import { type TableRecognition } from '@/domain/types/TableRecognition';
import { track } from '@/server/analytics/Analytics';
import { type Db, type DbExecutor } from '@/server/db/Database';
import { drafts, type RecognitionJobRow, users } from '@/server/db/Schema';
import { ApiError, SOURCE_GONE_MESSAGE } from '@/server/errors/ApiError';
import { type LoggedInContext, type RequestContext } from '@/server/http/RequestContext';
import { buildDraftInsert } from '@/server/services/DraftFactory';
import { scheduleOcrShadow } from '@/server/services/OcrShadowScheduler';
import { assertExtractAllowed, chargeExtract } from '@/server/services/RateLimitService';
import { isSourceAvailable, requireLoggedInOwnedJob } from '@/server/services/RecognitionOwnership';
import { extractPersonSchedule } from '@/server/services/RecognitionPersonExtractor';
import { readSourceBytes } from '@/server/services/RecognitionProcessService';

/** `draft_created` (Spec §23.3): counts only; `ms` from the extract request start to the new draft. */
const trackDraftCreated = (
  userId: string,
  jobId: string,
  entries: ShiftEntry[],
  requestStartedAt: number,
  manual: boolean,
): void => {
  track(AnalyticsEvent.DRAFT_CREATED, {
    actorUserId: userId,
    subject: { kind: AnalyticsSubjectKind.JOB, id: jobId },
    properties: {
      dayCount: entries.length,
      reviewCells: countReviewEntries(entries),
      unresolvedCells: countUnresolvedEntries(entries),
      ms: Math.max(0, Date.now() - requestStartedAt),
      manual,
    },
  });
};

/**
 * Same-process single flight per (job, row, month): concurrent identical extracts share one provider
 * call. Across instances the transaction re-check below still guarantees one draft and one charge.
 */
const inflightRowExtracts = new Map<string, Promise<ExtractRecognitionResponse>>();

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

const buildRowIdentity = (jobId: string, rowId: string, yearMonth: string) =>
  and(eq(drafts.recognitionJobId, jobId), eq(drafts.personRowId, rowId), eq(drafts.yearMonth, yearMonth));

const findRowDraft = async (db: DbExecutor, jobId: string, rowId: string, yearMonth: string) => {
  const [existing] = await db
    .select()
    .from(drafts)
    .where(buildRowIdentity(jobId, rowId, yearMonth))
    .limit(1);

  return existing ?? null;
};

const runRowExtract = async (
  db: Db,
  context: LoggedInContext,
  job: RecognitionJobRow,
  table: TableRecognition,
  candidate: { rowId: string; name: string },
  yearMonth: string,
  requestStartedAt: number,
): Promise<ExtractRecognitionResponse> => {
  // Refuse before the (slow, paid) provider call; the actual charge happens once, with the insert.
  await assertExtractAllowed(db, context.user.id);

  const { schedule, sourceBytes } = await extractPersonSchedule(
    job,
    table,
    candidate.rowId,
    candidate.name,
    yearMonth,
  );

  const outcome = await db.transaction(async (tx) => {
    await tx.select({ id: users.id }).from(users).where(eq(users.id, context.user.id)).for('update');

    const existing = await findRowDraft(tx, job.id, candidate.rowId, yearMonth);

    if (existing && existing.status !== DraftStatus.DISCARDED) {
      // A concurrent request won: drop our duplicate result without charging.
      return { draftId: existing.id, created: false };
    }

    if (existing) {
      // A discarded draft occupies the (job, row, month) key: replace it with a fresh editing draft.
      await tx.delete(drafts).where(eq(drafts.id, existing.id));
    }

    await chargeExtract(tx, context.user.id);

    const [inserted] = await tx
      .insert(drafts)
      .values(
        buildDraftInsert({
          userId: context.user.id,
          recognitionJobId: job.id,
          personRowId: candidate.rowId,
          basePublishedRevision: null,
          yearMonth,
          displayName: candidate.name,
          ...schedule,
          initialEntries: schedule.entries,
        }),
      )
      .returning({ id: drafts.id });

    if (!inserted) {
      throw new Error('Draft insert returned no row');
    }

    return { draftId: inserted.id, created: true };
  });

  if (outcome.created) {
    trackDraftCreated(context.user.id, job.id, schedule.entries, requestStartedAt, false);

    // Spec §22-11 shadow mode: after the response, the internal OCR route (its own function) reads the
    // photo and compares it with this draft's initial entries. Statistics only; the response is unchanged.
    scheduleOcrShadow({ draftId: outcome.draftId, jobId: job.id, sourceBytes }, requestStartedAt);
  }

  return { draftId: outcome.draftId };
};

const extractRowDraft = async (
  db: Db,
  context: LoggedInContext,
  job: RecognitionJobRow,
  table: TableRecognition,
  rowId: string,
  yearMonth: string,
  requestStartedAt: number,
): Promise<ExtractRecognitionResponse> => {
  const candidate = table.candidates.find((item) => item.rowId === rowId);

  if (!candidate) {
    throw new ApiError(ApiErrorCode.VALIDATION_ERROR, { message: '선택한 이름을 찾을 수 없어요.' });
  }

  const existing = await findRowDraft(db, job.id, rowId, yearMonth);

  if (existing && existing.status !== DraftStatus.DISCARDED) {
    return { draftId: existing.id };
  }

  const flightKey = `${job.id}:${rowId}:${yearMonth}`;
  const inflight = inflightRowExtracts.get(flightKey);

  if (inflight) {
    return inflight;
  }

  const flight = runRowExtract(db, context, job, table, candidate, yearMonth, requestStartedAt).finally(
    () => {
      inflightRowExtracts.delete(flightKey);
    },
  );

  inflightRowExtracts.set(flightKey, flight);

  return flight;
};

/** Name not in the candidates: empty draft (all dates MISSING_DATE) with the first-pass code legend. */
const extractManualDraft = async (
  db: Db,
  context: LoggedInContext,
  job: RecognitionJobRow,
  table: TableRecognition,
  manualName: string,
  yearMonth: string,
  requestStartedAt: number,
): Promise<ExtractRecognitionResponse> => {
  const outcome = await db.transaction(async (tx) => {
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
      return { draftId: existing.id, entries: null };
    }

    const schedule = normalizeExtraction(
      { yearMonth, rowId: '', displayName: manualName, definitions: table.definitions, cells: [] },
      yearMonth,
    );
    const [inserted] = await tx
      .insert(drafts)
      .values(
        buildDraftInsert({
          userId: context.user.id,
          recognitionJobId: job.id,
          personRowId: null,
          basePublishedRevision: null,
          yearMonth,
          displayName: manualName,
          ...schedule,
        }),
      )
      .returning({ id: drafts.id });

    if (!inserted) {
      throw new Error('Draft insert returned no row');
    }

    return { draftId: inserted.id, entries: schedule.entries };
  });

  if (outcome.entries) {
    trackDraftCreated(context.user.id, job.id, outcome.entries, requestStartedAt, true);
  }

  return { draftId: outcome.draftId };
};

/**
 * Second pass → personal draft. Idempotent per (job, row, month) and per (job, manual name, month).
 * `requestStartedAt` (epoch ms) bounds the wait for the shadow OCR call within the route's maxDuration.
 */
export const extractDraft = async (
  db: Db,
  context: RequestContext,
  jobId: string,
  input: ExtractRecognitionRequest,
  requestStartedAt: number = Date.now(),
): Promise<ExtractRecognitionResponse> => {
  const { context: loggedIn, job } = await requireLoggedInOwnedJob(db, context, jobId);
  const table = requireTableResult(job);

  if ('rowId' in input) {
    return extractRowDraft(db, loggedIn, job, table, input.rowId, input.yearMonth, requestStartedAt);
  }

  return extractManualDraft(db, loggedIn, job, table, input.manualName, input.yearMonth, requestStartedAt);
};
