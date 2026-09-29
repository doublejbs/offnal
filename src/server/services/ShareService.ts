import { and, asc, eq, inArray, sql } from 'drizzle-orm';

import { AnalyticsEvent } from '@/domain/enums/AnalyticsEvent';
import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { type SharedCalendarResponse } from '@/domain/types/api/SharedCalendarResponse';
import { type ShareSettingsResponse } from '@/domain/types/api/ShareSettingsResponse';
import { type UpdateShareRequest } from '@/domain/types/api/UpdateShareRequest';
import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';
import { isValidYearMonth } from '@/domain/YearMonth';
import { track } from '@/server/analytics/Analytics';
import { type Db, type DbExecutor, type DbTransaction } from '@/server/db/Database';
import { type CalendarRow, calendars, publishedMonths } from '@/server/db/Schema';
import { ApiError } from '@/server/errors/ApiError';
import { type RequestContext } from '@/server/http/RequestContext';
import { findCalendarForOwner } from '@/server/services/CalendarService';
import {
  hashShareToken,
  isShareTokenFormat,
  issueShareToken,
  resolveShareUrl,
} from '@/server/crypto/ShareTokens';
import { requireUser } from '@/server/validation/RequestGuards';

export const SHARE_EXPIRED_MESSAGE = '링크가 만료되었거나 공유가 중지되었어요.';

const NO_CALENDAR_MESSAGE = '공유할 달력이 아직 없어요. 먼저 한 달을 저장해 주세요.';
const SHARE_OFF_MESSAGE = '공유가 꺼져 있어요. 먼저 공유 링크를 만들어 주세요.';

type MonthVisibility = {
  yearMonth: string;
  shareVisible: boolean;
};

const listMonthVisibility = async (db: DbExecutor, calendarId: string): Promise<MonthVisibility[]> =>
  db
    .select({ yearMonth: publishedMonths.yearMonth, shareVisible: publishedMonths.shareVisible })
    .from(publishedMonths)
    .where(eq(publishedMonths.calendarId, calendarId))
    .orderBy(asc(publishedMonths.yearMonth));

const toShareSettings = (
  calendar: CalendarRow | null,
  months: MonthVisibility[],
  fallbackDisplayName: string,
): ShareSettingsResponse => ({
  enabled: calendar?.shareEnabled ?? false,
  url: resolveShareUrl(calendar),
  displayName: calendar?.displayName ?? fallbackDisplayName,
  visibleMonths: months.filter((month) => month.shareVisible).map((month) => month.yearMonth),
  availableMonths: months.map((month) => month.yearMonth),
});

const lockOwnedCalendar = async (tx: DbTransaction, userId: string): Promise<CalendarRow | null> => {
  const [calendar] = await tx.select().from(calendars).where(eq(calendars.ownerId, userId)).for('update');

  return calendar ?? null;
};

const requireLockedCalendar = async (tx: DbTransaction, userId: string): Promise<CalendarRow> => {
  const calendar = await lockOwnedCalendar(tx, userId);

  if (!calendar) {
    throw new ApiError(ApiErrorCode.NOT_FOUND, { message: NO_CALENDAR_MESSAGE });
  }

  return calendar;
};

/** GET /api/calendar/share. No calendar yet → disabled settings with the account name. */
export const getShareSettings = async (
  db: DbExecutor,
  context: RequestContext,
): Promise<ShareSettingsResponse> => {
  const { user } = requireUser(context);
  const calendar = await findCalendarForOwner(db, user.id);
  const months = calendar ? await listMonthVisibility(db, calendar.id) : [];

  return toShareSettings(calendar, months, user.displayName);
};

/**
 * POST /api/calendar/share: turns sharing on, sets the display name and exactly which published months
 * the link shows (others become hidden). Keeps the existing token; creates one when missing.
 */
export const updateShare = async (
  db: Db,
  context: RequestContext,
  body: UpdateShareRequest,
): Promise<ShareSettingsResponse> => {
  const { user } = requireUser(context);
  const requested = [...new Set(body.visibleMonths)].sort();
  const settings = await db.transaction(async (tx) => {
    const calendar = await requireLockedCalendar(tx, user.id);
    const available = new Set((await listMonthVisibility(tx, calendar.id)).map((month) => month.yearMonth));
    const invalidMonths = requested.filter((yearMonth) => !available.has(yearMonth));

    if (invalidMonths.length > 0) {
      throw new ApiError(ApiErrorCode.VALIDATION_ERROR, {
        message: '저장한 달만 공개할 수 있어요.',
        details: { invalidMonths },
      });
    }

    const issued = calendar.shareTokenHash && calendar.shareTokenCiphertext ? null : issueShareToken();
    const [updated] = await tx
      .update(calendars)
      .set({
        displayName: body.displayName,
        shareEnabled: true,
        ...(issued ? { shareTokenHash: issued.hash, shareTokenCiphertext: issued.ciphertext } : {}),
      })
      .where(eq(calendars.id, calendar.id))
      .returning();

    await tx
      .update(publishedMonths)
      .set({
        shareVisible: requested.length > 0 ? inArray(publishedMonths.yearMonth, requested) : sql`false`,
        // Visibility is not an edit: keep the month's "last updated" time.
        updatedAt: sql`${publishedMonths.updatedAt}`,
      })
      .where(eq(publishedMonths.calendarId, calendar.id));

    return toShareSettings(updated ?? calendar, await listMonthVisibility(tx, calendar.id), user.displayName);
  });

  track(AnalyticsEvent.EXPORT_LINK, { visibleMonthCount: settings.visibleMonths.length });

  return settings;
};

/** POST /api/calendar/share/rotate: new token; the old link is 404 from now on. */
export const rotateShare = async (db: Db, context: RequestContext): Promise<ShareSettingsResponse> => {
  const { user } = requireUser(context);

  return db.transaction(async (tx) => {
    const calendar = await requireLockedCalendar(tx, user.id);

    if (!calendar.shareEnabled) {
      throw new ApiError(ApiErrorCode.NOT_FOUND, { message: SHARE_OFF_MESSAGE });
    }

    const issued = issueShareToken();
    const [updated] = await tx
      .update(calendars)
      .set({
        shareTokenHash: issued.hash,
        shareTokenCiphertext: issued.ciphertext,
        shareRotatedAt: new Date(),
      })
      .where(eq(calendars.id, calendar.id))
      .returning();

    return toShareSettings(updated ?? calendar, await listMonthVisibility(tx, calendar.id), user.displayName);
  });
};

/** DELETE /api/calendar/share: sharing off and token removed (idempotent). Month visibility is kept. */
export const disableShare = async (db: Db, context: RequestContext): Promise<ShareSettingsResponse> => {
  const { user } = requireUser(context);

  return db.transaction(async (tx) => {
    const calendar = await lockOwnedCalendar(tx, user.id);

    if (!calendar) {
      return toShareSettings(null, [], user.displayName);
    }

    const [updated] = await tx
      .update(calendars)
      .set({ shareEnabled: false, shareTokenHash: null, shareTokenCiphertext: null })
      .where(eq(calendars.id, calendar.id))
      .returning();

    return toShareSettings(updated ?? calendar, await listMonthVisibility(tx, calendar.id), user.displayName);
  });
};

const throwShareNotFound = (): never => {
  throw new ApiError(ApiErrorCode.NOT_FOUND, { message: SHARE_EXPIRED_MESSAGE });
};

/** Copies known fields only, so nothing stored alongside a definition can leak. */
const toPublicDefinition = (definition: ShiftDefinition): ShiftDefinition => ({
  code: definition.code,
  label: definition.label,
  startTime: definition.startTime,
  endTime: definition.endTime,
  endsNextDay: definition.endsNextDay,
  isOff: definition.isOff,
});

/**
 * GET /api/shared/:token?month=YYYY-MM (public, also used by the /s/:token page). Only share-visible
 * months; entries carry date and code only. Unknown/disabled token or hidden month → 404.
 * `month` omitted → the latest visible month.
 */
export const getSharedCalendar = async (
  db: DbExecutor,
  token: string,
  month: string | null,
): Promise<SharedCalendarResponse> => {
  if (!isShareTokenFormat(token) || (month !== null && !isValidYearMonth(month))) {
    return throwShareNotFound();
  }

  const [calendar] = await db
    .select()
    .from(calendars)
    .where(and(eq(calendars.shareTokenHash, hashShareToken(token)), eq(calendars.shareEnabled, true)))
    .limit(1);

  if (!calendar) {
    return throwShareNotFound();
  }

  const visible = await db
    .select()
    .from(publishedMonths)
    .where(and(eq(publishedMonths.calendarId, calendar.id), eq(publishedMonths.shareVisible, true)))
    .orderBy(asc(publishedMonths.yearMonth));
  const target = month === null ? visible.at(-1) : visible.find((row) => row.yearMonth === month);

  if (month !== null && !target) {
    return throwShareNotFound();
  }

  return {
    displayName: calendar.displayName,
    months: visible.map((row) => row.yearMonth),
    month: target
      ? {
          yearMonth: target.yearMonth,
          definitions: target.definitions.map(toPublicDefinition),
          entries: target.entries.map((entry) => ({ date: entry.date, code: entry.code })),
          updatedAt: target.updatedAt.toISOString(),
        }
      : null,
  };
};
