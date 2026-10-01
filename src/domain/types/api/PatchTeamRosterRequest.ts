import { type NewTeamRosterRow } from '@/domain/types/api/NewTeamRosterRow';
import { type TeamRosterRowPatch } from '@/domain/types/api/TeamRosterRowPatch';
import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';

/**
 * PATCH /api/teams/:id/rosters/:rid (ADMIN, DRAFT only). `version` must equal the stored one (else 409
 * REVISION_CONFLICT with the current roster). Defining a code confirms every entry that only waited for that
 * definition (resolveDefinedCodes) in every row.
 */
export type PatchTeamRosterRequest = {
  version: number;
  /** Change the month; every row's entries are remapped by day number. */
  yearMonth?: string;
  /** Replaces the roster's definitions (unique codes). */
  definitions?: ShiftDefinition[];
  rows?: TeamRosterRowPatch[];
  addRows?: NewTeamRosterRow[];
};
