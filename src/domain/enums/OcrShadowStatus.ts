/** Outcome of one shadow OCR run (Spec §22-4). Stored as numbers only, never names or codes. */
export enum OcrShadowStatus {
  OK = 'ok',
  /** The table could not be read (no table, grid or day header). */
  TABLE_FAILED = 'table_failed',
  /** No single OCR row matches the chosen name. */
  ROW_NOT_FOUND = 'row_not_found',
  TIMEOUT = 'timeout',
  ERROR = 'error',
  /** Sampled, but another shadow run was already in flight on this instance (not run). */
  SKIPPED_BUSY = 'skipped_busy',
  /** Sampled, but too little of the route's maxDuration was left after the response (not run). */
  SKIPPED_BUDGET = 'skipped_budget',
}
