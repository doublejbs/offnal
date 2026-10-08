import 'server-only';

import { and, count, eq, isNull, lte, max, sql } from 'drizzle-orm';

import { isBetaFree } from '@/domain/BillingPolicy';
import { countEditedDays, countReviewEntries } from '@/domain/DraftReviewStats';
import { AnalyticsEvent } from '@/domain/enums/AnalyticsEvent';
import { AnalyticsSubjectKind } from '@/domain/enums/AnalyticsSubjectKind';
import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { DraftStatus } from '@/domain/enums/DraftStatus';
import { MonthAccess } from '@/domain/enums/MonthAccess';
import { RevisionConflictReason } from '@/domain/enums/RevisionConflictReason';
import { decideMonthAccess } from '@/domain/EntitlementPolicy';
import { getPublishBlockers } from '@/domain/ScheduleValidator';
import { type PublishDraftResponse } from '@/domain/types/api/PublishDraftResponse';
import { type RevisionConflictDetails } from '@/domain/types/api/RevisionConflictDetails';
import { type ShiftEntry } from '@/domain/types/ShiftEntry';
import { track } from '@/server/analytics/Analytics';
import { getAppConfig } from '@/server/config/AppConfig';
import { getPricing } from '@/server/config/PricingConfig';
import { type Db, type DbTransaction } from '@/server/db/Database';
import { calendars, drafts, publishedMonths, recognitionJobs, users } from '@/server/db/Schema';
import { ApiError, DRAFT_EXPIRED_MESSAGE } from '@/server/errors/ApiError';
import { type RequestContext } from '@/server/http/RequestContext';
import { isDraftExpired } from '@/server/services/DraftService';
import {
  countTrialEntitlements,
  hasEntitlement,
  insertBetaEntitlement,
  insertTrialEntitlement,
} from '@/server/services/EntitlementService';
import { findTeamMonthForUser } from '@/server/services/TeamMonthLookup';
import { getObjectStorage } from '@/server/storage/StorageFactory';
import { requireUser, requireUuid } from '@/server/validation/RequestGuards';

const TEAM_MONTH_PUBLISH_MESSAGE =
  '이 달은 팀 근무표가 있어 개인으로 저장할 수 없어요. 고칠 곳이 있으면 관리자에게 요청해 주세요.';

/** Analytics inputs of a new publish (Spec §23.3); null for an idempotent repeat. */
type PublishFacts = {
  entries: ShiftEntry[];
  initialEntries: ShiftEntry[] | null;
  /** The month had no published row before (first publish, or again after deletion). */
  newMonth: boolean;
  /** Position of this month among the calendar's published months, by first publish time. */
  monthIndex: number;
};

type PublishOutcome = PublishDraftResponse & { recognitionJobId: string | null; facts: PublishFacts | null };

const getOrCreateCalendarId = async (
  tx: DbTransaction,
  userId: string,
  displayName: string,
): Promise<string> => {
  await tx.insert(calendars).values({ ownerId: userId, displayName }).onConflictDoNothing();

  const [calendar] = await tx
    .select({ id: calendars.id })
    .from(calendars)
    .where(eq(calendars.ownerId, userId));

  if (!calendar) {
    throw new Error('Calendar upsert returned no row');
  }

  return calendar.id;
};

const findPublishedRevision = async (
  tx: DbTransaction,
  userId: string,
  yearMonth: string,
): Promise<number> => {
  const [row] = await tx
    .select({ revision: publishedMonths.revision })
    .from(publishedMonths)
    .innerJoin(calendars, eq(calendars.id, publishedMonths.calendarId))
    .where(and(eq(calendars.ownerId, userId), eq(publishedMonths.yearMonth, yearMonth)));

  return row?.revision ?? 0;
};

/**
 * Revision for a month that has no published row (first publish or re-created after deletion).
 * Continues above every edit draft's base revision, so edit drafts copied before a deletion stay stale.
 */
const findInitialRevision = async (tx: DbTransaction, userId: string, yearMonth: string): Promise<number> => {
  const [row] = await tx
    .select({ value: max(drafts.basePublishedRevision) })
    .from(drafts)
    .where(and(eq(drafts.userId, userId), eq(drafts.yearMonth, yearMonth)));

  return (row?.value ?? 0) + 1;
};

/**
 * Uses the month's entitlement, else (beta free) inserts a beta one without spending a trial, else inserts a
 * trial while free months remain, else 402. Returns whether a trial was used.
 */
const ensureEntitlement = async (tx: DbTransaction, userId: string, yearMonth: string): Promise<boolean> => {
  if (await hasEntitlement(tx, userId, yearMonth)) {
    return false;
  }

  const config = getAppConfig();

  if (isBetaFree(config)) {
    await insertBetaEntitlement(tx, userId, yearMonth);

    return false;
  }

  const pricing = getPricing(config);
  const access = decideMonthAccess({
    billingMode: config.billingMode,
    hasEntitlementForMonth: false,
    trialUsedCount: await countTrialEntitlements(tx, userId),
    freeMonthLimit: pricing.freeMonthLimit,
  });

  if (access === MonthAccess.PAYMENT_REQUIRED) {
    throw new ApiError(ApiErrorCode.PAYMENT_REQUIRED, { details: { yearMonth, priceKrw: pricing.priceKrw } });
  }

  await insertTrialEntitlement(tx, userId, yearMonth);

  return true;
};

/** Published months of the calendar first published at or before `publishedAt` (this month included). */
const countMonthsPublishedBy = async (
  tx: DbTransaction,
  calendarId: string,
  publishedAt: Date,
): Promise<number> => {
  const [row] = await tx
    .select({ value: count() })
    .from(publishedMonths)
    .where(and(eq(publishedMonths.calendarId, calendarId), lte(publishedMonths.publishedAt, publishedAt)));

  return row?.value ?? 1;
};

const throwConflict = (details: RevisionConflictDetails): never => {
  throw new ApiError(ApiErrorCode.REVISION_CONFLICT, { details });
};

const runPublishTransaction = async (
  db: Db,
  userId: string,
  draftId: string,
  revision: number,
): Promise<PublishOutcome> =>
  db.transaction(async (tx) => {
    // 1. Per-user serialization: concurrent publishes of different months cannot exceed the free limit.
    await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update');

    const [draft] = await tx
      .select()
      .from(drafts)
      .where(and(eq(drafts.id, draftId), eq(drafts.userId, userId)))
      .for('update');

    if (!draft || draft.status === DraftStatus.DISCARDED) {
      throw new ApiError(ApiErrorCode.NOT_FOUND);
    }

    if (draft.status === DraftStatus.PUBLISHED) {
      return {
        draftId: draft.id,
        yearMonth: draft.yearMonth,
        publishedRevision: await findPublishedRevision(tx, userId, draft.yearMonth),
        usedTrial: false,
        alreadyPublished: true,
        recognitionJobId: draft.recognitionJobId,
        facts: null,
      };
    }

    if (isDraftExpired(draft)) {
      throw new ApiError(ApiErrorCode.EXPIRED, { message: DRAFT_EXPIRED_MESSAGE });
    }

    // 2. Revision and blockers.
    if (draft.revision !== revision) {
      throwConflict({ reason: RevisionConflictReason.STALE_REVISION, currentRevision: draft.revision });
    }

    // An edit draft copied from an older snapshot must not silently revert a newer publish.
    const publishedRevision = await findPublishedRevision(tx, userId, draft.yearMonth);

    if (draft.basePublishedRevision !== null && draft.basePublishedRevision < publishedRevision) {
      throwConflict({
        reason: RevisionConflictReason.STALE_BASE,
        currentRevision: draft.revision,
        publishedRevision,
      });
    }

    // Team spec §0·§12-3: a month the member's team publishes is not saved personally (no free month spent
    // on a copy that would stay hidden behind the team month).
    if (await findTeamMonthForUser(tx, userId, draft.yearMonth)) {
      throw new ApiError(ApiErrorCode.TEAM_MONTH_READ_ONLY, { message: TEAM_MONTH_PUBLISH_MESSAGE });
    }

    const blockers = getPublishBlockers(draft.entries, draft.definitions);

    if (blockers.length > 0) {
      throw new ApiError(ApiErrorCode.PUBLISH_BLOCKED, { details: { blockers } });
    }

    // 3. Entitlement.
    const usedTrial = await ensureEntitlement(tx, userId, draft.yearMonth);
    // 4. Calendar.
    const calendarId = await getOrCreateCalendarId(tx, userId, draft.displayName);
    const initialRevision =
      publishedRevision === 0 ? await findInitialRevision(tx, userId, draft.yearMonth) : 1;
    // 5. Snapshot upsert. share_visible is not in the update set, so it is preserved (new rows default to false).
    const [published] = await tx
      .insert(publishedMonths)
      .values({
        calendarId,
        yearMonth: draft.yearMonth,
        revision: initialRevision,
        definitions: draft.definitions,
        entries: draft.entries,
        sourceDraftId: draft.id,
      })
      .onConflictDoUpdate({
        target: [publishedMonths.calendarId, publishedMonths.yearMonth],
        set: {
          revision: sql`${publishedMonths.revision} + 1`,
          definitions: draft.definitions,
          entries: draft.entries,
          sourceDraftId: draft.id,
          updatedAt: new Date(),
        },
      })
      .returning({ revision: publishedMonths.revision, publishedAt: publishedMonths.publishedAt });

    // 6. Draft → published (other editing drafts of the month are kept).
    await tx.update(drafts).set({ status: DraftStatus.PUBLISHED }).where(eq(drafts.id, draft.id));

    return {
      draftId: draft.id,
      yearMonth: draft.yearMonth,
      publishedRevision: published?.revision ?? initialRevision,
      usedTrial,
      alreadyPublished: false,
      recognitionJobId: draft.recognitionJobId,
      facts: {
        entries: draft.entries,
        initialEntries: draft.initialEntries,
        newMonth: publishedRevision === 0,
        monthIndex: await countMonthsPublishedBy(tx, calendarId, published?.publishedAt ?? new Date()),
      },
    };
  });

/** 7. Best effort after commit: a failure here is retried by the cleanup cron. */
export const deleteJobSourceBestEffort = async (db: Db, jobId: string): Promise<void> => {
  try {
    const [job] = await db
      .select()
      .from(recognitionJobs)
      .where(and(eq(recognitionJobs.id, jobId), isNull(recognitionJobs.sourceDeletedAt)));

    if (!job?.sourceObjectKey) {
      return;
    }

    await getObjectStorage().delete(job.sourceObjectKey);
    await db
      .update(recognitionJobs)
      .set({ sourceDeletedAt: new Date() })
      .where(eq(recognitionJobs.id, jobId));
  } catch (error: unknown) {
    console.warn('[publish] source deletion deferred to cleanup', {
      name: error instanceof Error ? error.name : typeof error,
    });
  }
};

/**
 * Spec §23.3: `review_completed` (AI drafts only: edits against the AI result), `month_published`, and
 * `next_month_registered` when a new month is the user's second or later.
 */
const trackPublish = (
  userId: string,
  recognitionJobId: string | null,
  response: PublishDraftResponse,
  facts: PublishFacts,
): void => {
  const subject = recognitionJobId ? { kind: AnalyticsSubjectKind.JOB, id: recognitionJobId } : null;

  if (facts.initialEntries) {
    const editedCells = countEditedDays(facts.initialEntries, facts.entries);

    track(AnalyticsEvent.REVIEW_COMPLETED, {
      actorUserId: userId,
      subject,
      properties: {
        editedCells,
        initialReviewCells: countReviewEntries(facts.initialEntries),
        fullMonthMatch: editedCells === 0,
      },
    });
  }

  track(AnalyticsEvent.MONTH_PUBLISHED, {
    actorUserId: userId,
    subject,
    properties: {
      revision: response.publishedRevision,
      monthIndex: facts.monthIndex,
      usedTrial: response.usedTrial,
      beta: isBetaFree(getAppConfig()),
    },
  });

  if (facts.newMonth && facts.monthIndex >= 2) {
    track(AnalyticsEvent.NEXT_MONTH_REGISTERED, {
      actorUserId: userId,
      properties: { monthIndex: facts.monthIndex },
    });
  }
};

/** Spec §7.2 publish transaction. Re-publishing an already published draft succeeds without a new entitlement. */
export const publishDraft = async (
  db: Db,
  context: RequestContext,
  draftId: string,
  revision: number,
): Promise<PublishDraftResponse> => {
  const { user } = requireUser(context);
  const { recognitionJobId, facts, ...response } = await runPublishTransaction(
    db,
    user.id,
    requireUuid(draftId),
    revision,
  );

  if (facts) {
    if (recognitionJobId) {
      await deleteJobSourceBestEffort(db, recognitionJobId);
    }

    trackPublish(user.id, recognitionJobId, response, facts);
  }

  return response;
};
