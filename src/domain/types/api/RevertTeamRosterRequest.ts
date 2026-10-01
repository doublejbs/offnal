/**
 * POST /api/teams/:id/rosters/:rid/revert (ADMIN) — optional body. Like publish, 422 PUBLISH_BLOCKED with
 * `details.unlinkedRows` when linked members' rows are missing from the reverted revision.
 */
export type RevertTeamRosterRequest = {
  /** Revert even though linked members' rows are missing (they lose this month). */
  confirmUnlinked?: boolean;
};
