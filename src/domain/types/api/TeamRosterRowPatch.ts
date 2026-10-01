import { type ShiftEntry } from '@/domain/types/ShiftEntry';

/** Edit of one existing row in PATCH /api/teams/:id/rosters/:rid. Rows still being read cannot be edited. */
export type TeamRosterRowPatch = {
  rowId: string;
  /** Fix a misread name. The row key (and linked member) stays. */
  displayName?: string;
  /** Whole month for this row (every date exactly once); a FAILED/PENDING row becomes MANUAL. */
  entries?: ShiftEntry[];
  /** Not a worker (e.g. a "-" only row): ignored for publishing and invisible to members. */
  excluded?: boolean;
  /** "이름 바뀜": take over this row key of the latest published revision (must be unused in this draft). */
  matchRowKey?: string;
};
