import { type CalendarMonthSource } from '@/domain/enums/CalendarMonthSource';
import { type TeamMonthInfo } from '@/domain/types/api/TeamMonthInfo';

/**
 * One month of the user's calendar. A published team month takes precedence over a personal month of the
 * same yearMonth (the personal one is kept and shows again after leaving the team).
 */
export type CalendarMonthSummary = {
  /** YYYY-MM */
  yearMonth: string;
  shareVisible: boolean;
  /** ISO 8601 */
  updatedAt: string;
  workCount: number;
  offCount: number;
  source: CalendarMonthSource;
  /** Set when `source` is TEAM. */
  team: TeamMonthInfo | null;
  /** TEAM month that hides a personal month of the same yearMonth ("이전 개인 저장본"). */
  hasPersonalBackup: boolean;
};
