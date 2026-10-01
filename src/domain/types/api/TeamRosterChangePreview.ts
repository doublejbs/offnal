import { type TeamRosterRowChanges } from '@/domain/types/api/TeamRosterRowChanges';

/** "바뀐 칸 N개(사람별)" before publishing: this draft vs. the latest published revision. */
export type TeamRosterChangePreview = {
  /** Published revision compared against. */
  comparedRevision: number;
  totalChangedCells: number;
  /** People with at least one changed cell, in roster order. */
  rows: TeamRosterRowChanges[];
};
