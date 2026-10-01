import { type TeamRosterViewRow } from '@/domain/types/api/TeamRosterViewRow';
import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';

/**
 * GET /api/teams/:id/roster/:yearMonth — latest published roster, read-only. ACTIVE members while
 * `shareRosterWithMembers` is on, admins always; otherwise 404. Excluded rows, review reasons and source cells
 * never appear.
 */
export type TeamRosterViewResponse = {
  teamId: string;
  teamName: string;
  /** YYYY-MM */
  yearMonth: string;
  revision: number;
  /** ISO 8601 */
  publishedAt: string;
  definitions: ShiftDefinition[];
  rows: TeamRosterViewRow[];
  myRowKey: string | null;
};
