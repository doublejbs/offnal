import { type TeamRosterDto } from '@/domain/types/api/TeamRosterDto';
import { type TeamRosterProgress } from '@/domain/types/api/TeamRosterProgress';

/** A roster in GET /api/teams/:id/rosters. */
export type TeamRosterSummaryDto = TeamRosterDto & {
  progress: TeamRosterProgress;
};
