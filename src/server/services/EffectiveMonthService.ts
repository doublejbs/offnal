import 'server-only';

import { and, asc, eq } from 'drizzle-orm';

import { CalendarMonthSource } from '@/domain/enums/CalendarMonthSource';
import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';
import { type ShiftEntry } from '@/domain/types/ShiftEntry';
import { isValidYearMonth } from '@/domain/YearMonth';
import { type DbExecutor } from '@/server/db/Database';
import { type CalendarRow, calendars, type PublishedMonthRow, publishedMonths } from '@/server/db/Schema';
import {
  buildTeamMonthKey,
  listSharedTeamMonthKeys,
  listTeamMonthsForUser,
  type TeamMonthRecord,
} from '@/server/services/TeamMonthLookup';

export type PersonalEffectiveMonth = {
  source: CalendarMonthSource.PERSONAL;
  yearMonth: string;
  calendar: CalendarRow;
  month: PublishedMonthRow;
  shareVisible: boolean;
};

export type TeamEffectiveMonth = {
  source: CalendarMonthSource.TEAM;
  yearMonth: string;
  /** The user's personal calendar (may not exist for team-only members). */
  calendar: CalendarRow | null;
  team: TeamMonthRecord;
  /** Personal month of the same yearMonth kept as "이전 개인 저장본" (shown again after leaving). */
  personal: PublishedMonthRow | null;
  /** On the member's share link (member_shared_team_months). */
  shareVisible: boolean;
};

/** One month of a user's calendar after applying "팀 근무 우선" (Team spec §12-3). */
export type EffectiveMonth = PersonalEffectiveMonth | TeamEffectiveMonth;

/** The user's personal calendar row (one per account), or null before the first save/share. */
export const findCalendarForOwner = async (db: DbExecutor, userId: string): Promise<CalendarRow | null> => {
  const [calendar] = await db.select().from(calendars).where(eq(calendars.ownerId, userId)).limit(1);

  return calendar ?? null;
};

/**
 * Personal published months ∪ team months, ascending. A team month replaces the personal month of the same
 * yearMonth (which is kept untouched). `calendar` may be passed when the caller already has it; `yearMonth`
 * restricts both queries to one month.
 */
export const listEffectiveMonths = async (
  db: DbExecutor,
  userId: string,
  knownCalendar?: CalendarRow | null,
  yearMonth?: string,
): Promise<EffectiveMonth[]> => {
  const calendar = knownCalendar === undefined ? await findCalendarForOwner(db, userId) : knownCalendar;
  const personal = calendar
    ? await db
        .select()
        .from(publishedMonths)
        .where(
          and(
            eq(publishedMonths.calendarId, calendar.id),
            yearMonth === undefined ? undefined : eq(publishedMonths.yearMonth, yearMonth),
          ),
        )
        .orderBy(asc(publishedMonths.yearMonth))
    : [];
  const teamMonths = await listTeamMonthsForUser(db, userId, yearMonth === undefined ? {} : { yearMonth });
  const sharedKeys = teamMonths.length > 0 ? await listSharedTeamMonthKeys(db, userId) : new Set<string>();
  const personalByMonth = new Map(personal.map((month) => [month.yearMonth, month]));
  const teamByMonth = new Map(teamMonths.map((record) => [record.yearMonth, record]));
  const yearMonths = [...new Set([...personalByMonth.keys(), ...teamByMonth.keys()])].sort();

  return yearMonths.flatMap((candidate): EffectiveMonth[] => {
    const team = teamByMonth.get(candidate);
    const month = personalByMonth.get(candidate) ?? null;

    if (team) {
      return [
        {
          source: CalendarMonthSource.TEAM,
          yearMonth: candidate,
          calendar,
          team,
          personal: month,
          shareVisible: sharedKeys.has(buildTeamMonthKey(team.teamId, candidate)),
        },
      ];
    }

    return calendar && month
      ? [
          {
            source: CalendarMonthSource.PERSONAL,
            yearMonth: candidate,
            calendar,
            month,
            shareVisible: month.shareVisible,
          },
        ]
      : [];
  });
};

export const findEffectiveMonth = async (
  db: DbExecutor,
  userId: string,
  yearMonth: string,
): Promise<EffectiveMonth | null> => {
  if (!isValidYearMonth(yearMonth)) {
    return null;
  }

  return (await listEffectiveMonths(db, userId, undefined, yearMonth))[0] ?? null;
};

export const getEffectiveUpdatedAt = (month: EffectiveMonth): Date =>
  month.source === CalendarMonthSource.TEAM ? month.team.publishedAt : month.month.updatedAt;

export type EffectiveSchedule = {
  definitions: ShiftDefinition[];
  entries: ShiftEntry[];
};

export const getEffectiveSchedule = (month: EffectiveMonth): EffectiveSchedule =>
  month.source === CalendarMonthSource.TEAM
    ? { definitions: month.team.definitions, entries: month.team.entries }
    : { definitions: month.month.definitions, entries: month.month.entries };
