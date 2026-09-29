import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';

/** GET /api/shared/:token?month=YYYY-MM — public, read-only. No review data, no source, no other people. */
export type SharedCalendarResponse = {
  displayName: string;
  /** Visible months, ascending. */
  months: string[];
  /** The requested month, or the latest visible month when `month` is omitted; null when nothing is visible. */
  month: {
    yearMonth: string;
    definitions: ShiftDefinition[];
    entries: { date: string; code: string | null }[];
    /** ISO 8601 */
    updatedAt: string;
  } | null;
};
