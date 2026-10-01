import 'server-only';

import { and, eq, gt, isNull } from 'drizzle-orm';

import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { CalendarMonthSource } from '@/domain/enums/CalendarMonthSource';
import { DraftStatus } from '@/domain/enums/DraftStatus';
import { countWorkAndOff } from '@/domain/ScheduleStats';
import { type CalendarMonthResponse } from '@/domain/types/api/CalendarMonthResponse';
import { type CalendarMonthSummary } from '@/domain/types/api/CalendarMonthSummary';
import { type CalendarSummaryResponse } from '@/domain/types/api/CalendarSummaryResponse';
import { type EditPublishedMonthResponse } from '@/domain/types/api/EditPublishedMonthResponse';
import { type OkResponse } from '@/domain/types/api/OkResponse';
import { type ShareSummary } from '@/domain/types/api/ShareSummary';
import { type TeamMonthInfo } from '@/domain/types/api/TeamMonthInfo';
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
import {
  type EffectiveMonth,
  findCalendarForOwner,
  findEffectiveMonth,
  getEffectiveSchedule,
  getEffectiveUpdatedAt,
  listEffectiveMonths,
} from '@/server/services/EffectiveMonthService';
import { getFreeRemainingForUser } from '@/server/services/EntitlementService';
import {
  buildTeamMonthInfo,
  buildTeamMonthInfos,
  findTeamMonthForUser,
} from '@/server/services/TeamMonthLookup';
import { resolveShareUrl } from '@/server/crypto/ShareTokens';
import { requireUser } from '@/server/validation/RequestGuards';

const TEAM_MONTH_DELETE_MESSAGE = '팀 근무표는 달력에서 지울 수 없어요. 팀에서 나가면 사라져요.';

export type OwnedPublishedMonth = {
  calendar: CalendarRow;
  month: PublishedMonthRow;
};

/** Owner's personal published month or null (team months: EffectiveMonthService). */
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

/** Share block of GET /api/calendar. */
export const buildShareSummary = (calendar: CalendarRow | null): ShareSummary => ({
  enabled: calendar?.shareEnabled ?? false,
  url: resolveShareUrl(calendar),
  displayName: calendar?.displayName ?? null,
});

const toMonthSummary = (month: EffectiveMonth, team: TeamMonthInfo | null): CalendarMonthSummary => {
  const { definitions, entries } = getEffectiveSchedule(month);

  return {
    yearMonth: month.yearMonth,
    shareVisible: month.shareVisible,
    updatedAt: getEffectiveUpdatedAt(month).toISOString(),
    ...countWorkAndOff(entries, definitions),
    source: month.source,
    team,
    hasPersonalBackup: month.source === CalendarMonthSource.TEAM && month.personal !== null,
  };
};

/** GET /api/calendar: personal and team months (team first for the same month), free months, share state. */
export const getCalendarSummary = async (
  db: DbExecutor,
  context: RequestContext,
): Promise<CalendarSummaryResponse> => {
  const { user } = requireUser(context);
  const calendar = await findCalendarForOwner(db, user.id);
  const months = await listEffectiveMonths(db, user.id, calendar);
  const teamMonths = months.flatMap((month) =>
    month.source === CalendarMonthSource.TEAM ? [month.team] : [],
  );
  // Acks and changes of every team month in two queries (no per-month reads).
  const infos = await buildTeamMonthInfos(db, teamMonths, user.id);
  const infoByMonth = new Map(infos.map((info, index) => [teamMonths[index]?.yearMonth, info]));
  const summaries = months.map((month) => toMonthSummary(month, infoByMonth.get(month.yearMonth) ?? null));

  return {
    calendar: calendar ? { displayName: calendar.displayName } : null,
    months: summaries,
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
  source: CalendarMonthSource.PERSONAL,
  readOnly: false,
  team: null,
  hasPersonalBackup: false,
});

/** GET /api/calendar/:ym — a team month (read-only) when one is published for the member, else the personal one. */
export const getPublishedMonth = async (
  db: DbExecutor,
  context: RequestContext,
  yearMonth: string,
): Promise<CalendarMonthResponse> => {
  const { user } = requireUser(context);
  const month = await findEffectiveMonth(db, user.id, yearMonth);

  if (!month) {
    throw new ApiError(ApiErrorCode.NOT_FOUND);
  }

  if (month.source === CalendarMonthSource.PERSONAL) {
    return toCalendarMonthResponse(month);
  }

  return {
    yearMonth: month.yearMonth,
    displayName: month.calendar?.displayName ?? user.displayName,
    definitions: month.team.definitions,
    entries: month.team.entries,
    revision: month.team.revision,
    updatedAt: month.team.publishedAt.toISOString(),
    shareVisible: month.shareVisible,
    source: CalendarMonthSource.TEAM,
    readOnly: true,
    team: await buildTeamMonthInfo(db, month.team, user.id),
    hasPersonalBackup: month.personal !== null,
  };
};

/** Members cannot edit or delete team months (Team spec §3.4). */
const assertNotTeamMonth = async (
  db: DbExecutor,
  userId: string,
  yearMonth: string,
  message?: string,
): Promise<void> => {
  if (isValidYearMonth(yearMonth) && (await findTeamMonthForUser(db, userId, yearMonth))) {
    throw new ApiError(ApiErrorCode.TEAM_MONTH_READ_ONLY, message ? { message } : {});
  }
};

/** Removes the published month only. Entitlements (and the used free month) are kept. */
export const deletePublishedMonth = async (
  db: DbExecutor,
  context: RequestContext,
  yearMonth: string,
): Promise<OkResponse> => {
  const { user } = requireUser(context);

  await assertNotTeamMonth(db, user.id, yearMonth, TEAM_MONTH_DELETE_MESSAGE);

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

  await assertNotTeamMonth(db, user.id, yearMonth);

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
