import { TeamRosterStatus } from '@/domain/enums/TeamRosterStatus';

type RosterLike = {
  yearMonth: string | null;
  status: TeamRosterStatus;
};

/**
 * Month the admin status card shows. Rule: this month if it has a published or draft roster; else the nearest
 * later month that has one; else the most recent earlier month; else this month (nothing uploaded yet). Pure.
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

/** Card eyebrow: "이번 달 근무표", "다가오는 근무표" (later month) or "최근 근무표" (earlier month). */
export const describeStatusMonth = (month: string, thisMonth: string): string => {
  if (month === thisMonth) {
    return '이번 달 근무표';
  }

  return month > thisMonth ? '다가오는 근무표' : '최근 근무표';
};

/**
 * Whether the admin must tick "근무 시간을 확인했어요" before publishing: only drafts created by a photo upload
 * (times read by AI), even after the photo expired. Copies of a published revision reuse confirmed times.
 */
export const requiresTimeConfirmation = (roster: { fromUpload: boolean }): boolean => roster.fromUpload;
