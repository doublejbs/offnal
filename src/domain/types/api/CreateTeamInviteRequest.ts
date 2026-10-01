/** POST /api/teams/:id/invites (ADMIN). */
export type CreateTeamInviteRequest = {
  /** 1–30, default 14. */
  expiresInDays?: number;
  /** Join requests accepted through this link; null/omitted = unlimited. */
  maxUses?: number | null;
};
