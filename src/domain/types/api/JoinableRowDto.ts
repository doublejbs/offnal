/** A roster row a person can pick as "me" (join picker, admin approval screen). */
export type JoinableRowDto = {
  rowKey: string;
  displayName: string;
  /** Position among rows with the same name ("김하루 (2)"); 1 when the name is unique. */
  sameNameOrdinal: number;
  /** Rows sharing this name in the roster (show the ordinal only when > 1). */
  sameNameCount: number;
  /** Codes of days 1–3 (null = empty) to tell same-name rows apart. */
  firstCodes: (string | null)[];
};
