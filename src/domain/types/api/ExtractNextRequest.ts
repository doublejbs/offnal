/** POST /api/teams/:id/rosters/:rid/extract-next (ADMIN). Body optional. */
export type ExtractNextRequest = {
  /** Also retry FAILED rows that have attempts left (the "다시 시도" button). */
  retryFailed?: boolean;
};
