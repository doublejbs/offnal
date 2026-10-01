/** POST /api/teams/:id/members/:userId/approve (ADMIN). */
export type ApproveTeamMemberRequest = {
  /** Omitted = approve the requested row; a key = link that row instead; null = approve without a row. */
  rowKey?: string | null;
};
