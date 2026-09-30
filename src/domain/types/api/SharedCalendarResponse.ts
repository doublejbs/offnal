import { type ShiftCodeEntry } from '@/domain/types/ShiftCodeEntry';
import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';

/** One visible month of a shared calendar. */
export type SharedMonth = {
  yearMonth: string;
  definitions: ShiftDefinition[];
  entries: ShiftCodeEntry[];
  /** ISO 8601 */
  updatedAt: string;
};

/** GET /api/shared/:token?month=YYYY-MM — public, read-only. No review data, no source, no other people. */
export type SharedCalendarResponse = {
  displayName: string;
  /** Visible months, ascending. */
  months: string[];
  /** The requested month, or the latest visible month when `month` is omitted; null when nothing is visible. */
  month: SharedMonth | null;
};
