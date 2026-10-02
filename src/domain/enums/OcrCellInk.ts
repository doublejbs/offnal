/** What a table cell holds after cleaning (Spec §20 OCR prototype). */
export enum OcrCellInk {
  /** No ink left after removing lines and specks. */
  BLANK = 'blank',
  /** A single short horizontal stroke (the roster's "no shift" dash). */
  DASH = 'dash',
  /** Glyphs to read with OCR. */
  TEXT = 'text',
}
