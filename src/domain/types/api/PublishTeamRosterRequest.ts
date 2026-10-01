/**
 * POST /api/teams/:id/rosters/:rid/publish (ADMIN). 422 PUBLISH_BLOCKED with `details.blockers`
 * (TeamRosterRowBlocker[]) while rows need review, or with `details.unlinkedRows` (PreviousRowRef[], blockers
 * empty) when linked members would lose their row — resend with `confirmUnlinked: true` to publish anyway.
 */
export type PublishTeamRosterRequest = {
  version: number;
  /** Publish even though linked members' rows are missing (they lose this month). */
  confirmUnlinked?: boolean;
};
