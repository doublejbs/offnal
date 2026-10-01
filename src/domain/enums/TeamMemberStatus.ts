/**
 * Membership lifecycle (Team spec §2·§3.2). Rejected requests, removed members and members who left all
 * become REMOVED: they lose access immediately and may request to join again with an invite.
 */
export enum TeamMemberStatus {
  PENDING = 'pending',
  ACTIVE = 'active',
  REMOVED = 'removed',
}
