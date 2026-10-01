import { type TeamMembershipSummary } from '@/domain/types/api/TeamMembershipSummary';

/**
 * GET /api/invites/:token — public. Unknown, revoked, expired or used-up link → 404. Before login the body
 * is exactly `{ teamName }` (no names or schedules); logged-in viewers also get their membership.
 */
export type InviteLookupResponse = {
  teamName: string;
  /** Logged-in viewers only: their PENDING/ACTIVE membership of this team, or null. Absent before login. */
  membership?: TeamMembershipSummary | null;
};
