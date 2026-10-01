import { type CalendarMonthSource } from '@/domain/enums/CalendarMonthSource';
import { type TeamMonthInfo } from '@/domain/types/api/TeamMonthInfo';
import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';
import { type ShiftEntry } from '@/domain/types/ShiftEntry';

/**
 * GET /api/calendar/:yearMonth — the published snapshot (owner only). For a TEAM month: the member's row of
 * the latest published team roster (entries carry no review reasons), `revision` = team revision, read-only.
 */
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
  source: CalendarMonthSource;
  /** TEAM months cannot be edited or deleted by the member (edit/delete → 409 TEAM_MONTH_READ_ONLY). */
  readOnly: boolean;
  team: TeamMonthInfo | null;
  hasPersonalBackup: boolean;
};
