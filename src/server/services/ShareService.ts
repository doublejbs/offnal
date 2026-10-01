import 'server-only';

import { and, eq, inArray, sql } from 'drizzle-orm';

import { AnalyticsEvent } from '@/domain/enums/AnalyticsEvent';
import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { CalendarMonthSource } from '@/domain/enums/CalendarMonthSource';
import { type ShareSettingsResponse } from '@/domain/types/api/ShareSettingsResponse';
import { type UpdateShareRequest } from '@/domain/types/api/UpdateShareRequest';
import { track } from '@/server/analytics/Analytics';
import { issueShareToken, resolveShareUrl } from '@/server/crypto/ShareTokens';
import { type Db, type DbExecutor, type DbTransaction } from '@/server/db/Database';
import { type CalendarRow, calendars, memberSharedTeamMonths, publishedMonths } from '@/server/db/Schema';
import { ApiError } from '@/server/errors/ApiError';
import { type RequestContext } from '@/server/http/RequestContext';
import { findCalendarForOwner } from '@/server/services/CalendarService';
import { type EffectiveMonth, listEffectiveMonths } from '@/server/services/EffectiveMonthService';
import { listTeamMonthsForUser } from '@/server/services/TeamMonthLookup';
import { requireUser } from '@/server/validation/RequestGuards';

const NO_CALENDAR_MESSAGE = '공유할 달력이 아직 없어요. 먼저 한 달을 저장해 주세요.';
const SHARE_OFF_MESSAGE = '공유가 꺼져 있어요. 먼저 공유 링크를 만들어 주세요.';

type MonthVisibility = {
  yearMonth: string;
  shareVisible: boolean;
  isTeam: boolean;
};

/** Every month of the owner's calendar (personal and team, team first per month) with its link visibility. */
const listMonthVisibility = async (
  db: DbExecutor,
  userId: string,
  calendar: CalendarRow | null,
): Promise<MonthVisibility[]> =>
  (await listEffectiveMonths(db, userId, calendar)).map((month) => ({
    yearMonth: month.yearMonth,
    shareVisible: month.shareVisible,
    isTeam: month.source === CalendarMonthSource.TEAM,
  }));

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
  teamMonths: months.filter((month) => month.isTeam).map((month) => month.yearMonth),
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

/**
 * The owner's calendar row for sharing. Team-only members (team months, no personal month yet) get one
 * created on first share, since the link token lives on it.
 */
const lockOrCreateCalendar = async (
  tx: DbTransaction,
  userId: string,
  displayName: string,
): Promise<CalendarRow> => {
  const existing = await lockOwnedCalendar(tx, userId);

  if (existing) {
    return existing;
  }

  if ((await listTeamMonthsForUser(tx, userId)).length === 0) {
    throw new ApiError(ApiErrorCode.NOT_FOUND, { message: NO_CALENDAR_MESSAGE });
  }

  await tx.insert(calendars).values({ ownerId: userId, displayName }).onConflictDoNothing();

  return requireLockedCalendar(tx, userId);
};

/** Team months on the link: exactly the requested ones of the member's current team months. */
const replaceSharedTeamMonths = async (
  tx: DbTransaction,
  userId: string,
  months: EffectiveMonth[],
  requested: Set<string>,
): Promise<void> => {
  await tx.delete(memberSharedTeamMonths).where(eq(memberSharedTeamMonths.userId, userId));

  const visible = months.flatMap((month) =>
    month.source === CalendarMonthSource.TEAM && requested.has(month.yearMonth)
      ? [{ teamId: month.team.teamId, userId, yearMonth: month.yearMonth }]
      : [],
  );

  if (visible.length > 0) {
    await tx.insert(memberSharedTeamMonths).values(visible);
  }
};

/**
 * Personal months shown on the link. Personal months hidden behind a team month keep their own flag, so they
 * come back with the visibility they had once the member leaves the team.
 */
const updatePersonalVisibility = async (
  tx: DbTransaction,
  calendarId: string,
  months: EffectiveMonth[],
  requested: Set<string>,
): Promise<void> => {
  const personal = months
    .filter((month) => month.source === CalendarMonthSource.PERSONAL)
    .map((month) => month.yearMonth);
  const visible = personal.filter((yearMonth) => requested.has(yearMonth));

  if (personal.length === 0) {
    return;
  }

  await tx
    .update(publishedMonths)
    .set({
      shareVisible: visible.length > 0 ? inArray(publishedMonths.yearMonth, visible) : sql`false`,
      // Visibility is not an edit: keep the month's "last updated" time.
      updatedAt: sql`${publishedMonths.updatedAt}`,
    })
    .where(and(eq(publishedMonths.calendarId, calendarId), inArray(publishedMonths.yearMonth, personal)));
};

/** GET /api/calendar/share. No calendar yet → disabled settings with the account name. */
export const getShareSettings = async (
  db: DbExecutor,
  context: RequestContext,
): Promise<ShareSettingsResponse> => {
  const { user } = requireUser(context);
  const calendar = await findCalendarForOwner(db, user.id);

  return toShareSettings(calendar, await listMonthVisibility(db, user.id, calendar), user.displayName);
};

/**
 * POST /api/calendar/share: turns sharing on, sets the display name and exactly which months (personal or
 * team) the link shows (others become hidden). Keeps the existing token; creates one when missing.
 */
export const updateShare = async (
  db: Db,
  context: RequestContext,
  body: UpdateShareRequest,
): Promise<ShareSettingsResponse> => {
  const { user } = requireUser(context);
  const requested = [...new Set(body.visibleMonths)].sort();
  const settings = await db.transaction(async (tx) => {
    const calendar = await lockOrCreateCalendar(tx, user.id, body.displayName);
    const months = await listEffectiveMonths(tx, user.id, calendar);
    const available = new Set(months.map((month) => month.yearMonth));
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
    const requestedSet = new Set(requested);

    await updatePersonalVisibility(tx, calendar.id, months, requestedSet);
    await replaceSharedTeamMonths(tx, user.id, months, requestedSet);

    return toShareSettings(
      updated ?? calendar,
      await listMonthVisibility(tx, user.id, updated ?? calendar),
      user.displayName,
    );
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

    return toShareSettings(
      updated ?? calendar,
      await listMonthVisibility(tx, user.id, updated ?? calendar),
      user.displayName,
    );
  });
};

/** DELETE /api/calendar/share: sharing off and token removed (idempotent). Month visibility is kept. */
export const disableShare = async (db: Db, context: RequestContext): Promise<ShareSettingsResponse> => {
  const { user } = requireUser(context);

  return db.transaction(async (tx) => {
    const calendar = await lockOwnedCalendar(tx, user.id);

    if (!calendar) {
      return toShareSettings(null, await listMonthVisibility(tx, user.id, null), user.displayName);
    }

    const [updated] = await tx
      .update(calendars)
      .set({ shareEnabled: false, shareTokenHash: null, shareTokenCiphertext: null })
      .where(eq(calendars.id, calendar.id))
      .returning();

    return toShareSettings(
      updated ?? calendar,
      await listMonthVisibility(tx, user.id, updated ?? calendar),
      user.displayName,
    );
  });
};
