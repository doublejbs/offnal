import { and, eq } from 'drizzle-orm';

import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { DraftStatus } from '@/domain/enums/DraftStatus';
import { remapDraftMonth } from '@/domain/DraftMonthRemapper';
import { getPublishBlockers, hasExactDateSet, summarizeReview } from '@/domain/ScheduleValidator';
import { type DraftDto } from '@/domain/types/api/DraftDto';
import { type DraftResponse } from '@/domain/types/api/DraftResponse';
import { type OkResponse } from '@/domain/types/api/OkResponse';
import { type PatchDraftRequest } from '@/domain/types/api/PatchDraftRequest';
import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';
import { type ShiftEntry } from '@/domain/types/ShiftEntry';
import { type DbExecutor } from '@/server/db/Database';
import { isUniqueViolation } from '@/server/db/DbErrors';
import { type DraftRow, drafts, recognitionJobs } from '@/server/db/Schema';
import { ApiError } from '@/server/http/ApiError';
import { type RequestContext, requireUser } from '@/server/http/RequestContext';
import { requireUuid } from '@/server/http/RouteHelpers';
import { getMonthAccessInfo } from '@/server/services/EntitlementService';
import { isSourceAvailable } from '@/server/services/RecognitionService';

const toDraftDto = (draft: DraftRow): DraftDto => ({
  id: draft.id,
  status: draft.status,
  revision: draft.revision,
  yearMonth: draft.yearMonth,
  displayName: draft.displayName,
  definitions: draft.definitions,
  entries: draft.entries,
  updatedAt: draft.updatedAt.toISOString(),
  expiresAt: draft.expiresAt.toISOString(),
});

export const buildDraftResponse = async (db: DbExecutor, draft: DraftRow): Promise<DraftResponse> => {
  const [job] = draft.recognitionJobId
    ? await db.select().from(recognitionJobs).where(eq(recognitionJobs.id, draft.recognitionJobId)).limit(1)
    : [];

  return {
    draft: toDraftDto(draft),
    sourceCells: draft.sourceCells,
    sourceAvailable: isSourceAvailable(job && job.userId === draft.userId ? job : null),
    jobId: draft.recognitionJobId,
    blockers: getPublishBlockers(draft.entries, draft.definitions),
    review: summarizeReview(draft.entries),
    access: await getMonthAccessInfo(db, draft.userId, draft.yearMonth),
  };
};

/** Owner's non-discarded draft, else 404. */
export const findOwnedDraft = async (db: DbExecutor, userId: string, draftId: string): Promise<DraftRow> => {
  const [draft] = await db
    .select()
    .from(drafts)
    .where(and(eq(drafts.id, requireUuid(draftId)), eq(drafts.userId, userId)))
    .limit(1);

  if (!draft || draft.status === DraftStatus.DISCARDED) {
    throw new ApiError(ApiErrorCode.NOT_FOUND);
  }

  return draft;
};

export const isDraftExpired = (draft: DraftRow, now = new Date()): boolean =>
  draft.expiresAt.getTime() <= now.getTime();

export const getDraft = async (
  db: DbExecutor,
  context: RequestContext,
  draftId: string,
): Promise<DraftResponse> => {
  const { user } = requireUser(context);
  const draft = await findOwnedDraft(db, user.id, draftId);

  if (isDraftExpired(draft)) {
    throw new ApiError(ApiErrorCode.EXPIRED, { message: '초안 보관 기간이 지났어요.' });
  }

  return buildDraftResponse(db, draft);
};

const throwRevisionConflict = async (db: DbExecutor, userId: string, draftId: string): Promise<never> => {
  const current = await findOwnedDraft(db, userId, draftId);

  throw new ApiError(ApiErrorCode.REVISION_CONFLICT, {
    details: { draft: await buildDraftResponse(db, current) },
  });
};

/** Off codes carry no times; entries without a code can never be confirmed. */
const normalizeDefinitions = (definitions: ShiftDefinition[]): ShiftDefinition[] =>
  definitions.map((definition) =>
    definition.isOff
      ? { ...definition, label: definition.label.trim(), startTime: null, endTime: null, endsNextDay: null }
      : { ...definition, label: definition.label.trim() },
  );

const normalizeEntries = (entries: ShiftEntry[]): ShiftEntry[] =>
  [...entries]
    .sort((left, right) => left.date.localeCompare(right.date))
    .map((entry) => ({
      date: entry.date,
      code: entry.code,
      reviewReasons: [...new Set(entry.reviewReasons)],
      confirmed: entry.code === null ? false : entry.confirmed,
    }));

const resolvePatchedEntries = (draft: DraftRow, body: PatchDraftRequest, yearMonth: string): ShiftEntry[] => {
  if (body.entries) {
    if (!hasExactDateSet(body.entries, yearMonth)) {
      throw new ApiError(ApiErrorCode.VALIDATION_ERROR, {
        message: '대상 월의 모든 날짜가 한 번씩 있어야 해요.',
        details: { fields: ['entries'] },
      });
    }

    return normalizeEntries(body.entries);
  }

  if (yearMonth !== draft.yearMonth) {
    return remapDraftMonth(draft.entries, draft.yearMonth, yearMonth);
  }

  return draft.entries;
};

/** Optimistic update: the WHERE revision guard makes concurrent edits fail with 409 instead of overwriting. */
export const patchDraft = async (
  db: DbExecutor,
  context: RequestContext,
  draftId: string,
  body: PatchDraftRequest,
): Promise<DraftResponse> => {
  const { user } = requireUser(context);
  const draft = await findOwnedDraft(db, user.id, draftId);

  if (draft.status !== DraftStatus.EDITING) {
    throw new ApiError(ApiErrorCode.DRAFT_NOT_EDITABLE);
  }

  if (isDraftExpired(draft)) {
    throw new ApiError(ApiErrorCode.EXPIRED, { message: '초안 보관 기간이 지났어요.' });
  }

  if (body.revision !== draft.revision) {
    return throwRevisionConflict(db, user.id, draft.id);
  }

  const yearMonth = body.yearMonth ?? draft.yearMonth;
  const entries = resolvePatchedEntries(draft, body, yearMonth);
  const definitions = body.definitions ? normalizeDefinitions(body.definitions) : draft.definitions;
  let updated: DraftRow | undefined;

  try {
    [updated] = await db
      .update(drafts)
      .set({
        yearMonth,
        entries,
        definitions,
        displayName: body.displayName ?? draft.displayName,
        revision: draft.revision + 1,
      })
      .where(
        and(
          eq(drafts.id, draft.id),
          eq(drafts.revision, body.revision),
          eq(drafts.status, DraftStatus.EDITING),
        ),
      )
      .returning();
  } catch (error: unknown) {
    if (isUniqueViolation(error)) {
      throw new ApiError(ApiErrorCode.VALIDATION_ERROR, {
        message: '같은 사진·이름으로 만든 그 달의 초안이 이미 있어요.',
        details: { fields: ['yearMonth'] },
      });
    }

    throw error;
  }

  if (!updated) {
    return throwRevisionConflict(db, user.id, draft.id);
  }

  return buildDraftResponse(db, updated);
};

/** Marks an editing draft as discarded. Entitlements and published months are untouched. */
export const discardDraft = async (
  db: DbExecutor,
  context: RequestContext,
  draftId: string,
): Promise<OkResponse> => {
  const { user } = requireUser(context);
  const draft = await findOwnedDraft(db, user.id, draftId);

  if (draft.status !== DraftStatus.EDITING) {
    throw new ApiError(ApiErrorCode.DRAFT_NOT_EDITABLE);
  }

  await db
    .update(drafts)
    .set({ status: DraftStatus.DISCARDED })
    .where(and(eq(drafts.id, draft.id), eq(drafts.status, DraftStatus.EDITING)));

  return { ok: true };
};
