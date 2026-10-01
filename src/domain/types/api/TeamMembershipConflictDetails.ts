import { type TeamMembershipConflictReason } from '@/domain/enums/TeamMembershipConflictReason';

/** `error.details` of a 409 TEAM_MEMBERSHIP_CONFLICT. */
export type TeamMembershipConflictDetails = {
  reason: TeamMembershipConflictReason;
};
