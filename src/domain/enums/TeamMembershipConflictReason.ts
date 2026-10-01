/** `details.reason` of a 409 TEAM_MEMBERSHIP_CONFLICT. */
export enum TeamMembershipConflictReason {
  /** The user is already an active member (or admin) of the team. */
  ALREADY_MEMBER = 'already_member',
  /** The user already has a pending join request. */
  ALREADY_REQUESTED = 'already_requested',
  /** Another active member is already linked to the requested row. */
  ROW_TAKEN = 'row_taken',
  /** The team must keep at least one admin. */
  LAST_ADMIN = 'last_admin',
  /** The member is not in a state that allows this action (e.g. approving an active member). */
  INVALID_STATE = 'invalid_state',
}
