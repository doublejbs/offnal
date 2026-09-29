import { and, asc, eq, gt, isNull } from 'drizzle-orm';

import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { DraftStatus } from '@/domain/enums/DraftStatus';
import { countWorkAndOff } from '@/domain/ScheduleStats';
import { type CalendarMonthResponse } from '@/domain/types/api/CalendarMonthResponse';
import { type CalendarMonthSummary } from '@/domain/types/api/CalendarMonthSummary';
import { type CalendarSummaryResponse } from '@/domain/types/api/CalendarSummaryResponse';
import { type EditPublishedMonthResponse } from '@/domain/types/api/EditPublishedMonthResponse';
import { type OkResponse } from '@/domain/types/api/OkResponse';
import { type ShareSummary } from '@/domain/types/api/ShareSummary';
import { isValidYearMonth } from '@/domain/YearMonth';
import { getAppConfig } from '@/server/config/AppConfig';
import { getPricing } from '@/server/config/PricingConfig';
import { type Db, type DbExecutor } from '@/server/db/Database';
import {
  type CalendarRow,
  calendars,
  drafts,
  type PublishedMonthRow,
  publishedMonths,
  users,
} from '@/server/db/Schema';
import { ApiError } from '@/server/errors/ApiError';
import { type RequestContext } from '@/server/http/RequestContext';
import { buildDraftInsert } from '@/server/services/DraftFactory';
import { getFreeRemainingForUser } from '@/server/services/EntitlementService';
import { requireUser } from '@/server/validation/RequestGuards';

export type OwnedPublishedMonth = {
  calendar: CalendarRow;
  month: PublishedMonthRow;
};

export const findCalendarForOwner = async (db: DbExecutor, userId: string): Promise<CalendarRow | null> => {
  const [calendar] = await db.select().from(calendars).where(eq(calendars.ownerId, userId)).limit(1);

  return calendar ?? null;
};

/** Owner's published month or null. Also the lookup for ICS/PNG export (Task 2b adds the entitlement check). */
export const findOwnedPublishedMonth = async (
  db: DbExecutor,
  userId: string,
  yearMonth: string,
): Promise<OwnedPublishedMonth | null> => {
  if (!isValidYearMonth(yearMonth)) {
    return null;
  }

  const [row] = await db
    .select({ calendar: calendars, month: publishedMonths })
    .from(publishedMonths)
    .innerJoin(calendars, eq(calendars.id, publishedMonths.calendarId))
    .where(and(eq(calendars.ownerId, userId), eq(publishedMonths.yearMonth, yearMonth)))
    .limit(1);

  return row ?? null;
};

const requireOwnedPublishedMonth = async (
  db: DbExecutor,
  userId: string,
  yearMonth: string,
): Promise<OwnedPublishedMonth> => {
  const owned = await findOwnedPublishedMonth(db, userId, yearMonth);

  if (!owned) {
    throw new ApiError(ApiErrorCode.NOT_FOUND);
  }

  return owned;
};

/**
 * Share block of GET /api/calendar. Stub until Task 2b (ShareService): always disabled.
 * Keep the shape; 2b fills `enabled`/`url` from calendars.share_enabled / share_token_ciphertext.
 */
export const buildShareSummary = (calendar: CalendarRow | null): ShareSummary => ({
  enabled: false,
  url: null,
  displayName: calendar?.displayName ?? null,
});

const toMonthSummary = (month: PublishedMonthRow): CalendarMonthSummary => ({
  yearMonth: month.yearMonth,
  shareVisible: month.shareVisible,
  updatedAt: month.updatedAt.toISOString(),
  ...countWorkAndOff(month.entries, month.definitions),
});

export const getCalendarSummary = async (
  db: DbExecutor,
  context: RequestContext,
): Promise<CalendarSummaryResponse> => {
  const { user } = requireUser(context);
  const calendar = await findCalendarForOwner(db, user.id);
  const months = calendar
    ? await db
        .select()
        .from(publishedMonths)
        .where(eq(publishedMonths.calendarId, calendar.id))
        .orderBy(asc(publishedMonths.yearMonth))
    : [];

  return {
    calendar: calendar ? { displayName: calendar.displayName } : null,
    months: months.map(toMonthSummary),
    share: buildShareSummary(calendar),
    freeRemaining: await getFreeRemainingForUser(db, user.id),
    priceKrw: getPricing(getAppConfig()).priceKrw,
  };
};

export const toCalendarMonthResponse = ({ calendar, month }: OwnedPublishedMonth): CalendarMonthResponse => ({
  yearMonth: month.yearMonth,
  displayName: calendar.displayName,
  definitions: month.definitions,
  entries: month.entries,
  revision: month.revision,
  updatedAt: month.updatedAt.toISOString(),
  shareVisible: month.shareVisible,
});

export const getPublishedMonth = async (
  db: DbExecutor,
  context: RequestContext,
  yearMonth: string,
): Promise<CalendarMonthResponse> => {
  const { user } = requireUser(context);

  return toCalendarMonthResponse(await requireOwnedPublishedMonth(db, user.id, yearMonth));
};

/** Removes the published month only. Entitlements (and the used free month) are kept. */
export const deletePublishedMonth = async (
  db: DbExecutor,
  context: RequestContext,
  yearMonth: string,
): Promise<OkResponse> => {
  const { user } = requireUser(context);
  const { month } = await requireOwnedPublishedMonth(db, user.id, yearMonth);

  await db.delete(publishedMonths).where(eq(publishedMonths.id, month.id));

  return { ok: true };
};

/**
 * New editing draft from the published snapshot (no recognition job). Reuses an open edit draft only
 * when it was copied from the current published revision; older ones are left for publish to reject.
 */
export const createEditDraftFromPublished = async (
  db: Db,
  context: RequestContext,
  yearMonth: string,
): Promise<EditPublishedMonthResponse> => {
  const { user } = requireUser(context);
  const { calendar, month } = await requireOwnedPublishedMonth(db, user.id, yearMonth);

  return db.transaction(async (tx) => {
    await tx.select({ id: users.id }).from(users).where(eq(users.id, user.id)).for('update');

    const now = new Date();
    const [existing] = await tx
      .select({ id: drafts.id })
      .from(drafts)
      .where(
        and(
          eq(drafts.userId, user.id),
          eq(drafts.yearMonth, month.yearMonth),
          eq(drafts.status, DraftStatus.EDITING),
          isNull(drafts.recognitionJobId),
          eq(drafts.basePublishedRevision, month.revision),
          gt(drafts.expiresAt, now),
        ),
      )
      .limit(1);

    if (existing) {
      return { draftId: existing.id };
    }

    const [inserted] = await tx
      .insert(drafts)
      .values(
        buildDraftInsert(
          {
            userId: user.id,
            recognitionJobId: null,
            personRowId: null,
            basePublishedRevision: month.revision,
            yearMonth: month.yearMonth,
            displayName: calendar.displayName,
            definitions: month.definitions,
            entries: month.entries,
            sourceCells: [],
          },
          now,
        ),
      )
      .returning({ id: drafts.id });

    if (!inserted) {
      throw new Error('Draft insert returned no row');
    }

    return { draftId: inserted.id };
  });
};
