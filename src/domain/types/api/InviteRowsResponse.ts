import { type JoinableRowDto } from '@/domain/types/api/JoinableRowDto';

/**
 * GET /api/invites/:token/rows — logged in. Rows of the team's most recent published roster that no active
 * member is linked to (excluded rows omitted). No published roster → `yearMonth: null, rows: []` (join with
 * `rowKey: null`; an admin links the row later).
 */
export type InviteRowsResponse = {
  /** YYYY-MM of the roster the rows come from. */
  yearMonth: string | null;
  rows: JoinableRowDto[];
};
