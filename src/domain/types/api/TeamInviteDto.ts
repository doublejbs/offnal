/** Invite link metadata. The token is never stored or shown again after the issue response. */
export type TeamInviteDto = {
  id: string;
  /** ISO 8601 */
  createdAt: string;
  /** ISO 8601 */
  expiresAt: string;
  /** ISO 8601, set when an admin stopped the link. */
  revokedAt: string | null;
  maxUses: number | null;
  useCount: number;
  /** Not revoked, not expired and uses left. */
  active: boolean;
};
