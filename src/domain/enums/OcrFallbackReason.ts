/** Why the hybrid (`ocr-then-ai`) handed a person to AI (Spec §21). */
export enum OcrFallbackReason {
  /** No table, grid or day header found by OCR. */
  TABLE_FAILED = 'table-failed',
  /** The person's name was not read exactly (or appears twice). */
  NAME_NOT_FOUND = 'name-not-found',
  /** OCR left at least the threshold of cells unresolved. */
  UNRESOLVED_CELLS = 'unresolved-cells',
}
