import { type TeamMemberStatus } from '@/domain/enums/TeamMemberStatus';
import { type TeamRole } from '@/domain/enums/TeamRole';
import { type TeamDto } from '@/domain/types/api/TeamDto';
import { type TeamPublishedMonthSummary } from '@/domain/types/api/TeamPublishedMonthSummary';

/**
 * POST /api/teams (201), GET /api/teams/:id, PATCH /api/teams/:id. ACTIVE members and admins only;
 * everyone else (non-member, PENDING, REMOVED) gets 404.
 */
export type TeamDetailResponse = {
  team: TeamDto;
  myRole: TeamRole;
  myStatus: TeamMemberStatus;
  myLinkedRowKey: string | null;
  /** Published months, ascending. */
  publishedMonths: TeamPublishedMonthSummary[];
  /** Pending join requests (admins only; 0 for members). */
  pendingRequestCount: number;
};
