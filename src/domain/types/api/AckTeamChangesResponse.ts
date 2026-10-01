/** POST /api/teams/:id/acks. */
export type AckTeamChangesResponse = {
  yearMonth: string;
  acknowledgedRevision: number;
};
