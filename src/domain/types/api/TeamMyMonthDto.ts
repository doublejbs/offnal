import { type TeamCellChange } from '@/domain/types/api/TeamCellChange';
import { type ShiftCodeEntry } from '@/domain/types/ShiftCodeEntry';
import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';

/** The member's own row of one published team month (codes only, no review data). */
export type TeamMyMonthDto = {
  /** YYYY-MM */
  yearMonth: string;
  revision: number;
  /** ISO 8601 */
  publishedAt: string;
  displayName: string;
  /** Same-name position / count in that revision ("김하루 (2)" when count > 1). */
  sameNameOrdinal: number;
  sameNameCount: number;
  definitions: ShiftDefinition[];
  entries: ShiftCodeEntry[];
  /** Dates changed since the revision the member acknowledged ("변경" badges). */
  changes: TeamCellChange[];
  /** Revision the member acknowledged (POST /api/teams/:id/acks). */
  acknowledgedRevision: number;
};
