/** A person of the latest published revision that no row of this draft matches. */
export type PreviousRowRef = {
  rowKey: string;
  displayName: string;
  /** An active member is linked to this key (they would lose their month unless a row is matched). */
  linked: boolean;
};
