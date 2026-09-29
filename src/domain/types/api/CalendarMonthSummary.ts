export type CalendarMonthSummary = {
  /** YYYY-MM */
  yearMonth: string;
  shareVisible: boolean;
  /** ISO 8601 */
  updatedAt: string;
  workCount: number;
  offCount: number;
};
