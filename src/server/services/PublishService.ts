import { and, count, eq, isNull, sql } from 'drizzle-orm';

import { AnalyticsEvent } from '@/domain/enums/AnalyticsEvent';
import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { DraftStatus } from '@/domain/enums/DraftStatus';
import { EntitlementSource } from '@/domain/enums/EntitlementSource';
import { MonthAccess } from '@/domain/enums/MonthAccess';
import { decideMonthAccess } from '@/domain/EntitlementPolicy';
import { getPublishBlockers } from '@/domain/ScheduleValidator';
import { type PublishDraftResponse } from '@/domain/types/api/PublishDraftResponse';
import { track } from '@/server/analytics/Analytics';
import { getAppConfig } from '@/server/config/AppConfig';
import { getPricing } from '@/server/config/PricingConfig';
import { type Db, type DbTransaction } from '@/server/db/Database';
import { calendars, drafts, entitlements, publishedMonths, recognitionJobs, users } from '@/server/db/Schema';
import { ApiError } from '@/server/http/ApiError';
import { type RequestContext, requireUser } from '@/server/http/RequestContext';
import { requireUuid } from '@/server/http/RouteHelpers';
import { isDraftExpired } from '@/server/services/DraftService';
import { getObjectStorage } from '@/server/storage/StorageFactory';

type PublishOutcome = PublishDraftResponse & { recognitionJobId: string | null };

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

/** Uses the month's entitlement, else inserts a trial while free months remain, else 402. */
const ensureEntitlement = async (tx: DbTransaction, userId: string, yearMonth: string): Promise<boolean> => {
  const [existing] = await tx
    .select({ id: entitlements.id })
    .from(entitlements)
    .where(and(eq(entitlements.userId, userId), eq(entitlements.yearMonth, yearMonth)));

  if (existing) {
    return false;
  }

  const pricing = getPricing(getAppConfig());
  const [trials] = await tx
    .select({ value: count() })
    .from(entitlements)
    .where(and(eq(entitlements.userId, userId), eq(entitlements.source, EntitlementSource.TRIAL)));
  const access = decideMonthAccess({
    hasEntitlementForMonth: false,
    trialUsedCount: trials?.value ?? 0,
    freeMonthLimit: pricing.freeMonthLimit,
  });

  if (access === MonthAccess.PAYMENT_REQUIRED) {
    throw new ApiError(ApiErrorCode.PAYMENT_REQUIRED, { details: { yearMonth, priceKrw: pricing.priceKrw } });
  }

  await tx.insert(entitlements).values({ userId, yearMonth, source: EntitlementSource.TRIAL });

  return true;
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
      };
    }

    if (isDraftExpired(draft)) {
      throw new ApiError(ApiErrorCode.EXPIRED, { message: '초안 보관 기간이 지났어요.' });
    }

    // 2. Revision and blockers.
    if (draft.revision !== revision) {
      throw new ApiError(ApiErrorCode.REVISION_CONFLICT, { details: { currentRevision: draft.revision } });
    }

    const blockers = getPublishBlockers(draft.entries, draft.definitions);

    if (blockers.length > 0) {
      throw new ApiError(ApiErrorCode.PUBLISH_BLOCKED, { details: { blockers } });
    }

    // 3. Entitlement.
    const usedTrial = await ensureEntitlement(tx, userId, draft.yearMonth);
    // 4. Calendar.
    const calendarId = await getOrCreateCalendarId(tx, userId, draft.displayName);
    // 5. Snapshot upsert. share_visible is not in the update set, so it is preserved (new rows default to false).
    const [published] = await tx
      .insert(publishedMonths)
      .values({
        calendarId,
        yearMonth: draft.yearMonth,
        revision: 1,
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
      .returning({ revision: publishedMonths.revision });

    // 6. Draft → published (other editing drafts of the month are kept).
    await tx.update(drafts).set({ status: DraftStatus.PUBLISHED }).where(eq(drafts.id, draft.id));

    return {
      draftId: draft.id,
      yearMonth: draft.yearMonth,
      publishedRevision: published?.revision ?? 1,
      usedTrial,
      alreadyPublished: false,
      recognitionJobId: draft.recognitionJobId,
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

/** Spec §7.2 publish transaction. Re-publishing an already published draft succeeds without a new entitlement. */
export const publishDraft = async (
  db: Db,
  context: RequestContext,
  draftId: string,
  revision: number,
): Promise<PublishDraftResponse> => {
  const { user } = requireUser(context);
  const { recognitionJobId, ...response } = await runPublishTransaction(
    db,
    user.id,
    requireUuid(draftId),
    revision,
  );

  if (!response.alreadyPublished) {
    if (recognitionJobId) {
      await deleteJobSourceBestEffort(db, recognitionJobId);
    }

    track(AnalyticsEvent.MONTH_PUBLISHED, {
      usedTrial: response.usedTrial,
      revision: response.publishedRevision,
    });
  }

  return response;
};
