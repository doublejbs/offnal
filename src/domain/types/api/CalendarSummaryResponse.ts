import { type CalendarMonthSummary } from '@/domain/types/api/CalendarMonthSummary';
import { type ShareSummary } from '@/domain/types/api/ShareSummary';

/** GET /api/calendar. `months` is sorted by yearMonth ascending. */
export type CalendarSummaryResponse = {
  calendar: { displayName: string } | null;
  months: CalendarMonthSummary[];
  share: ShareSummary;
  freeRemaining: number;
  priceKrw: number;
};
