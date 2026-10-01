/**
 * POST /api/teams/:id/rosters/:rid/draft (ADMIN) — a DRAFT copy of a published roster for direct edits
 * (new revision on publish). An open copy of the same revision is reused.
 */
export type CreateRosterDraftResponse = {
  rosterId: string;
};
