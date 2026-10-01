import { type TeamMembershipSummary } from '@/domain/types/api/TeamMembershipSummary';

/** GET /api/teams — the viewer's PENDING and ACTIVE memberships, oldest team first. */
export type TeamListResponse = {
  teams: TeamMembershipSummary[];
};
