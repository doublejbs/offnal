/** POST /api/teams/:id/acks (ACTIVE member) — hides the "변경" badges up to `revision`. */
export type AckTeamChangesRequest = {
  /** YYYY-MM */
  yearMonth: string;
  /** Published revision being acknowledged (capped at the current one; never moves backwards). */
  revision: number;
};
