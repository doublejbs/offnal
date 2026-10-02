/** Outcome of one shadow OCR run (Spec §21-4). Stored as numbers only, never names or codes. */
export enum OcrShadowStatus {
  OK = 'ok',
  /** The table could not be read (no table, grid or day header). */
  TABLE_FAILED = 'table_failed',
  /** No single OCR row matches the chosen name. */
  ROW_NOT_FOUND = 'row_not_found',
  TIMEOUT = 'timeout',
  ERROR = 'error',
}
