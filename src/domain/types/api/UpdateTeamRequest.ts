/** PATCH /api/teams/:id (ADMIN) — team settings. Omitted fields are unchanged. */
export type UpdateTeamRequest = {
  name?: string;
  shareRosterWithMembers?: boolean;
};
