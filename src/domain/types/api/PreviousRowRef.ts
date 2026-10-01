/** A person of the latest published revision that no row of this draft matches. */
export type PreviousRowRef = {
  rowKey: string;
  displayName: string;
  /** Same-name position / count in that published revision ("김하루 (2)" when count > 1). */
  sameNameOrdinal: number;
  sameNameCount: number;
  /** An active member is linked to this key (they would lose their month unless a row is matched). */
  linked: boolean;
};
