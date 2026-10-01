import { type TeamRosterSummaryDto } from '@/domain/types/api/TeamRosterSummaryDto';

/** GET /api/teams/:id/rosters (ADMIN) — drafts, published and archived revisions, newest first. */
export type TeamRosterListResponse = {
  rosters: TeamRosterSummaryDto[];
};
