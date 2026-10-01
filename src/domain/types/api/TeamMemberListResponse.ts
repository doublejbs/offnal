import { type JoinableRowDto } from '@/domain/types/api/JoinableRowDto';
import { type TeamMemberDto } from '@/domain/types/api/TeamMemberDto';

/** GET /api/teams/:id/members (ADMIN) — PENDING requests first (oldest first), then ACTIVE members. */
export type TeamMemberListResponse = {
  members: TeamMemberDto[];
  /** YYYY-MM of the latest published roster used for `linkedRow`; null when none. */
  rosterYearMonth: string | null;
  /** Rows of that roster still free to link (for "올바른 행으로 바꿔 승인"). */
  availableRows: JoinableRowDto[];
};
