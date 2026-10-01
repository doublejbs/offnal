/**
 * POST /api/teams/:id/rosters (ADMIN, multipart: `file`, `authorityConfirmed=true`, optional `yearMonth`)
 * → 201. Then call POST .../rosters/:rid/extract-next until `progress.phase` is READY.
 */
export type CreateTeamRosterResponse = {
  rosterId: string;
};
