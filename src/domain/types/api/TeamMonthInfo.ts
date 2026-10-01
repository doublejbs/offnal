import { type TeamCellChange } from '@/domain/types/api/TeamCellChange';

/** Team source of a calendar month (`source: TEAM`). The month is read-only for the member. */
export type TeamMonthInfo = {
  teamId: string;
  /** Shown as "<teamName> 근무표". */
  teamName: string;
  revision: number;
  /** ISO 8601 */
  publishedAt: string;
  /** Dates changed since the acknowledged revision ("변경" badges + "캘린더에 다시 추가" notice). */
  changes: TeamCellChange[];
  acknowledgedRevision: number;
};
