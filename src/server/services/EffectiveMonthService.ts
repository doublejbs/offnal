import 'server-only';

import { asc, eq } from 'drizzle-orm';

import { CalendarMonthSource } from '@/domain/enums/CalendarMonthSource';
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

export const findCalendarOfOwner = async (db: DbExecutor, userId: string): Promise<CalendarRow | null> => {
  const [calendar] = await db.select().from(calendars).where(eq(calendars.ownerId, userId)).limit(1);

  return calendar ?? null;
};

/**
 * Personal published months ∪ team months, ascending. A team month replaces the personal month of the same
 * yearMonth (which is kept untouched). `calendar` may be passed when the caller already has it.
 */
export const listEffectiveMonths = async (
  db: DbExecutor,
  userId: string,
  knownCalendar?: CalendarRow | null,
): Promise<EffectiveMonth[]> => {
  const calendar = knownCalendar === undefined ? await findCalendarOfOwner(db, userId) : knownCalendar;
  const personal = calendar
    ? await db
        .select()
        .from(publishedMonths)
        .where(eq(publishedMonths.calendarId, calendar.id))
        .orderBy(asc(publishedMonths.yearMonth))
    : [];
  const teamMonths = await listTeamMonthsForUser(db, userId);
  const sharedKeys = teamMonths.length > 0 ? await listSharedTeamMonthKeys(db, userId) : new Set<string>();
  const personalByMonth = new Map(personal.map((month) => [month.yearMonth, month]));
  const teamByMonth = new Map(teamMonths.map((record) => [record.yearMonth, record]));
  const yearMonths = [...new Set([...personalByMonth.keys(), ...teamByMonth.keys()])].sort();

  return yearMonths.flatMap((yearMonth): EffectiveMonth[] => {
    const team = teamByMonth.get(yearMonth);
    const month = personalByMonth.get(yearMonth) ?? null;

    if (team) {
      return [
        {
          source: CalendarMonthSource.TEAM,
          yearMonth,
          calendar,
          team,
          personal: month,
          shareVisible: sharedKeys.has(buildTeamMonthKey(team.teamId, yearMonth)),
        },
      ];
    }

    return calendar && month
      ? [
          {
            source: CalendarMonthSource.PERSONAL,
            yearMonth,
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

  return (await listEffectiveMonths(db, userId)).find((month) => month.yearMonth === yearMonth) ?? null;
};

export const getEffectiveUpdatedAt = (month: EffectiveMonth): Date =>
  month.source === CalendarMonthSource.TEAM ? month.team.publishedAt : month.month.updatedAt;

export const getEffectiveSchedule = (month: EffectiveMonth) =>
  month.source === CalendarMonthSource.TEAM
    ? { definitions: month.team.definitions, entries: month.team.entries }
    : { definitions: month.month.definitions, entries: month.month.entries };
