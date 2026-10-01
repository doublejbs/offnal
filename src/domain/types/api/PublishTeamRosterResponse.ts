/** POST .../publish and POST .../revert (ADMIN). */
export type PublishTeamRosterResponse = {
  /** The published roster (for revert: the new copy). */
  rosterId: string;
  yearMonth: string;
  revision: number;
  /** Cells that changed vs. the previous published revision (0 for revision 1). */
  changedCellCount: number;
  /** The same draft was already published (idempotent repeat). */
  alreadyPublished: boolean;
};
