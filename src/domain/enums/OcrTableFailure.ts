/** Why the AI-free reader could not use a photo (Spec §20); the hybrid then hands every person to AI. */
export enum OcrTableFailure {
  /** No table-like line component (or an implausible border quad). */
  NO_TABLE = 'no-table',
  /** Too few row/column lines in the flattened table. */
  NO_GRID = 'no-grid',
  /** No header row with contiguous day numbers 1…N. */
  NO_HEADER = 'no-header',
}
