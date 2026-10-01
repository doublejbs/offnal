import { type PreviousRowRef } from '@/domain/types/api/PreviousRowRef';
import { type TeamRosterChangePreview } from '@/domain/types/api/TeamRosterChangePreview';
import { type TeamRosterDto } from '@/domain/types/api/TeamRosterDto';
import { type TeamRosterProgress } from '@/domain/types/api/TeamRosterProgress';
import { type TeamRosterRowBlocker } from '@/domain/types/api/TeamRosterRowBlocker';
import { type TeamRosterRowDto } from '@/domain/types/api/TeamRosterRowDto';
import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';

/**
 * GET/PATCH /api/teams/:id/rosters/:rid (ADMIN) — the full roster with review data. Also
 * `details.roster` of a 409 REVISION_CONFLICT from PATCH.
 */
export type TeamRosterResponse = {
  roster: TeamRosterDto;
  progress: TeamRosterProgress;
  /** One legend for every row (edit once per roster). */
  definitions: ShiftDefinition[];
  /** All rows (excluded included), by position. */
  rows: TeamRosterRowDto[];
  /** Rows that block publishing. */
  blockers: TeamRosterRowBlocker[];
  /** DRAFT with rows, nothing waiting for extraction, no blockers and at least one included row. */
  publishable: boolean;
  /** Latest published revision of the month (0 = none). */
  latestPublishedRevision: number;
  /** Previous people this draft lost (pick "이름 바뀜" with `matchRowKey`, or leave as removed). */
  unmatchedPreviousRows: PreviousRowRef[];
  /** Null when the month has no published revision yet (or for non-drafts). */
  changesPreview: TeamRosterChangePreview | null;
};
