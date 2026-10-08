import 'server-only';

import { and, eq } from 'drizzle-orm';

import { AnalyticsEvent } from '@/domain/enums/AnalyticsEvent';
import { AnalyticsSubjectKind } from '@/domain/enums/AnalyticsSubjectKind';
import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { buildSharedIcsFileName } from '@/domain/ExportFileNames';
import { buildIcs } from '@/domain/IcsBuilder';
import { SHARE_EXPIRED_MESSAGE } from '@/domain/ShareMessages';
import { type SharedCalendarResponse } from '@/domain/types/api/SharedCalendarResponse';
import { type ShiftCodeEntry } from '@/domain/types/ShiftCodeEntry';
import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';
import { formatYearMonthLabel, isValidYearMonth } from '@/domain/YearMonth';
import { track } from '@/server/analytics/Analytics';
import { hashShareToken, isShareTokenFormat } from '@/server/crypto/ShareTokens';
import { buildStableUidBase } from '@/server/crypto/StableUid';
import { type DbExecutor } from '@/server/db/Database';
import { type CalendarRow, calendars } from '@/server/db/Schema';
import { ApiError } from '@/server/errors/ApiError';
import {
  type EffectiveMonth,
  getEffectiveSchedule,
  getEffectiveUpdatedAt,
  listEffectiveMonths,
} from '@/server/services/EffectiveMonthService';
import { type IcsExport } from '@/server/services/ExportService';

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

type SharedMonthLookup = {
  calendar: CalendarRow;
  visible: EffectiveMonth[];
  /** The requested month, or the latest visible month when `month` is omitted; undefined when none. */
  target: EffectiveMonth | undefined;
};

/**
 * Token → enabled calendar → share-visible months of the owner's calendar (personal months, and team months
 * while the owner is an ACTIVE member — a team month replaces the personal one of the same month). Unknown or
 * disabled token, malformed input or a requested month that is not visible → the same 404.
 */
const findSharedMonth = async (
  db: DbExecutor,
  token: string,
  month: string | null,
): Promise<SharedMonthLookup> => {
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

  const visible = (await listEffectiveMonths(db, calendar.ownerId, calendar)).filter(
    (item) => item.shareVisible,
  );
  const target = month === null ? visible.at(-1) : visible.find((item) => item.yearMonth === month);

  if (month !== null && !target) {
    return throwShareNotFound();
  }

  return { calendar, visible, target };
};

/** Date and code only: never review data, sources, team names or other people. */
const toPublicSchedule = (
  month: EffectiveMonth,
): { definitions: ShiftDefinition[]; entries: ShiftCodeEntry[] } => {
  const { definitions, entries } = getEffectiveSchedule(month);

  return {
    definitions: definitions.map(toPublicDefinition),
    entries: entries.map((entry) => ({ date: entry.date, code: entry.code })),
  };
};

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
  const { calendar, visible, target } = await findSharedMonth(db, token, month);

  track(AnalyticsEvent.SHARED_CALENDAR_VIEWED, {
    subject: { kind: AnalyticsSubjectKind.CALENDAR, id: calendar.id },
  });

  return {
    displayName: calendar.displayName,
    months: visible.map((item) => item.yearMonth),
    month: target
      ? {
          yearMonth: target.yearMonth,
          ...toPublicSchedule(target),
          updatedAt: getEffectiveUpdatedAt(target).toISOString(),
        }
      : null,
  };
};

/**
 * GET /api/shared/:token/export.ics?month=YYYY-MM&includeOff=1 — the recipient's one-time import of the
 * viewed month. Same checks as getSharedCalendar; nothing visible → 404. Titles carry the sharer's name.
 */
export const exportSharedMonthIcs = async (
  db: DbExecutor,
  token: string,
  month: string | null,
  includeOff: boolean,
): Promise<IcsExport> => {
  const { calendar, target } = await findSharedMonth(db, token, month);

  if (!target) {
    return throwShareNotFound();
  }

  const body = buildIcs({
    calendarId: calendar.id,
    uidBase: buildStableUidBase(calendar.id),
    displayName: calendar.displayName,
    titlePrefix: calendar.displayName,
    calendarName: `${calendar.displayName}님의 근무 · ${formatYearMonthLabel(target.yearMonth)}`,
    yearMonth: target.yearMonth,
    ...toPublicSchedule(target),
    includeOff,
    generatedAt: new Date(),
  });

  track(AnalyticsEvent.EXPORT_ICS, {
    subject: { kind: AnalyticsSubjectKind.CALENDAR, id: calendar.id },
    properties: { includeOff, shared: true },
  });

  return { fileName: buildSharedIcsFileName(target.yearMonth), body };
};
