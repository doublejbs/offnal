/** Overall progress of a draft roster as reported by GET/extract-next (derived, not stored). */
export enum TeamRosterPhase {
  /** First pass (table recognition) has not finished yet: keep calling extract-next. */
  RECOGNIZING = 'recognizing',
  /** First pass failed. `progress.retryable` tells whether extract-next will try again. */
  RECOGNITION_FAILED = 'recognition_failed',
  /** Rows exist and some are still PENDING/PROCESSING: keep calling extract-next. */
  EXTRACTING = 'extracting',
  /** No row is waiting (rows are DONE, MANUAL or FAILED). Review, fix and publish. */
  READY = 'ready',
}
