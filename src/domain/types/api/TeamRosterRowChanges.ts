import { type TeamCellChange } from '@/domain/types/api/TeamCellChange';

/** Changed cells of one person. */
export type TeamRosterRowChanges = {
  rowKey: string;
  displayName: string;
  changes: TeamCellChange[];
};
