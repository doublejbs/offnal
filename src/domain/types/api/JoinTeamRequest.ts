/** POST /api/invites/:token/join — creates a PENDING request (admin approval required). */
export type JoinTeamRequest = {
  /** Row from GET /api/invites/:token/rows; null when the team has no published roster yet. */
  rowKey: string | null;
};
