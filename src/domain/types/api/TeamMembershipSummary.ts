import { type TeamMemberStatus } from '@/domain/enums/TeamMemberStatus';
import { type TeamRole } from '@/domain/enums/TeamRole';

/** One of the viewer's teams (GET /api/teams, join response). REMOVED memberships are never listed. */
export type TeamMembershipSummary = {
  teamId: string;
  teamName: string;
  role: TeamRole;
  /** PENDING (waiting for approval) or ACTIVE. */
  status: TeamMemberStatus;
  /** Roster row linked to the viewer (requested row while PENDING); null when none. */
  linkedRowKey: string | null;
};
