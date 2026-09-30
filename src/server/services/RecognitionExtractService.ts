import 'server-only';

import { and, eq, isNull } from 'drizzle-orm';

import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { DraftStatus } from '@/domain/enums/DraftStatus';
import { RecognitionErrorCode } from '@/domain/enums/RecognitionErrorCode';
import { RecognitionStatus } from '@/domain/enums/RecognitionStatus';
import { normalizeExtraction } from '@/domain/ScheduleValidator';
import { type CandidatesResponse } from '@/domain/types/api/CandidatesResponse';
import { type ExtractRecognitionRequest } from '@/domain/types/api/ExtractRecognitionRequest';
import { type ExtractRecognitionResponse } from '@/domain/types/api/ExtractRecognitionResponse';
import { type NormalizedSchedule } from '@/domain/types/NormalizedSchedule';
import { type PersonExtraction } from '@/domain/types/PersonExtraction';
import { type TableRecognition } from '@/domain/types/TableRecognition';
import { getAppConfig } from '@/server/config/AppConfig';
import { type Db, type DbExecutor } from '@/server/db/Database';
import { drafts, type RecognitionJobRow, users } from '@/server/db/Schema';
import { ApiError, SOURCE_GONE_MESSAGE } from '@/server/errors/ApiError';
import { type LoggedInContext, type RequestContext } from '@/server/http/RequestContext';
import { buildDraftInsert } from '@/server/services/DraftFactory';
import { assertExtractAllowed, chargeExtract } from '@/server/services/RateLimitService';
import { isSourceAvailable, requireLoggedInOwnedJob } from '@/server/services/RecognitionOwnership';
import { loadSourceForVision, readSourceBytes } from '@/server/services/RecognitionProcessService';
import { buildRowContext } from '@/server/vision/RowIdentity';
import { getVisionProvider } from '@/server/vision/VisionFactory';
import {
  extractPersonWithPipeline,
  type PipelineCallRunner,
  preparePipelineImage,
} from '@/server/vision/VisionPipeline';
import { toRecognitionErrorCode } from '@/server/vision/VisionProvider';

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

const toProviderApiError = (code: RecognitionErrorCode): ApiError => {
  if (code === RecognitionErrorCode.PROVIDER_NOT_CONFIGURED) {
    return new ApiError(ApiErrorCode.PROVIDER_NOT_CONFIGURED);
  }

  if (code === RecognitionErrorCode.SOURCE_MISSING) {
    return new ApiError(ApiErrorCode.EXPIRED, { message: SOURCE_GONE_MESSAGE });
  }

  return new ApiError(ApiErrorCode.PROVIDER_ERROR, { details: { reason: code } });
};

/** Provider call only; normalization runs outside the try so bugs surface as 500, not 502. */
const extractPersonSchedule = async (
  job: RecognitionJobRow,
  table: TableRecognition,
  rowId: string,
  name: string,
  yearMonth: string,
): Promise<NormalizedSchedule> => {
  if (!isSourceAvailable(job)) {
    throw new ApiError(ApiErrorCode.EXPIRED, { message: SOURCE_GONE_MESSAGE });
  }

  const source = await loadSourceForVision(job);

  if (!source.ok) {
    throw toProviderApiError(source.errorCode);
  }

  const config = getAppConfig();
  // One budget for every call of the pipeline (locate + extract), like the single call before §15.
  const signal = AbortSignal.timeout(config.visionTimeoutMs);
  const runCall: PipelineCallRunner = (_step, run) => run(signal);
  // The warped image lives only in memory for this request (source lifetime rules unchanged).
  const prepared = await preparePipelineImage(config.visionPipeline, source.image, table.grid);
  let extraction: PersonExtraction;

  try {
    ({ extraction } = await extractPersonWithPipeline(
      getVisionProvider(),
      prepared,
      {
        rowId,
        name,
        yearMonth,
        definitions: table.definitions,
        rowContext: buildRowContext(table.candidates, rowId),
      },
      runCall,
    ));
  } catch (error: unknown) {
    throw toProviderApiError(toRecognitionErrorCode(error, signal));
  }

  return normalizeExtraction(extraction, yearMonth);
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
): Promise<ExtractRecognitionResponse> => {
  // Refuse before the (slow, paid) provider call; the actual charge happens once, with the insert.
  await assertExtractAllowed(db, context.user.id);

  const schedule = await extractPersonSchedule(job, table, candidate.rowId, candidate.name, yearMonth);

  return db.transaction(async (tx) => {
    await tx.select({ id: users.id }).from(users).where(eq(users.id, context.user.id)).for('update');

    const existing = await findRowDraft(tx, job.id, candidate.rowId, yearMonth);

    if (existing && existing.status !== DraftStatus.DISCARDED) {
      // A concurrent request won: drop our duplicate result without charging.
      return { draftId: existing.id };
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
        }),
      )
      .returning({ id: drafts.id });

    if (!inserted) {
      throw new Error('Draft insert returned no row');
    }

    return { draftId: inserted.id };
  });
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

  const existing = await findRowDraft(db, job.id, rowId, yearMonth);

  if (existing && existing.status !== DraftStatus.DISCARDED) {
    return { draftId: existing.id };
  }

  const flightKey = `${job.id}:${rowId}:${yearMonth}`;
  const inflight = inflightRowExtracts.get(flightKey);

  if (inflight) {
    return inflight;
  }

  const flight = runRowExtract(db, context, job, table, candidate, yearMonth).finally(() => {
    inflightRowExtracts.delete(flightKey);
  });

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
