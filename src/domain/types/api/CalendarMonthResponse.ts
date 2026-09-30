import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';
import { type ShiftEntry } from '@/domain/types/ShiftEntry';

/** GET /api/calendar/:yearMonth — the published snapshot (owner only). */
export type CalendarMonthResponse = {
  /** YYYY-MM */
  yearMonth: string;
  displayName: string;
  definitions: ShiftDefinition[];
  entries: ShiftEntry[];
  revision: number;
  /** ISO 8601 */
  updatedAt: string;
  shareVisible: boolean;
};
