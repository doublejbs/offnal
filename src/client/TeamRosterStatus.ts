import { TeamRosterStatus } from '@/domain/enums/TeamRosterStatus';

type RosterLike = {
  yearMonth: string | null;
  status: TeamRosterStatus;
};

/**
 * Month the admin status card is about: this month when it has a published or draft roster, otherwise the
 * nearest upcoming month that has one, otherwise the latest past one; this month when nothing exists. Pure.
 */
export const pickStatusMonth = (rosters: RosterLike[], thisMonth: string): string => {
  const months = [
    ...new Set(
      rosters
        .filter((roster) => roster.status !== TeamRosterStatus.ARCHIVED && roster.yearMonth !== null)
        .map((roster) => roster.yearMonth ?? ''),
    ),
  ].sort();

  if (months.includes(thisMonth)) {
    return thisMonth;
  }

  return months.find((month) => month > thisMonth) ?? months.at(-1) ?? thisMonth;
};

/** "이번 달 근무표" / "다음 근무표" / "지난 근무표" for the card's eyebrow. */
export const describeStatusMonth = (month: string, thisMonth: string): string => {
  if (month === thisMonth) {
    return '이번 달 근무표';
  }

  return month > thisMonth ? '다가오는 근무표' : '최근 근무표';
};
