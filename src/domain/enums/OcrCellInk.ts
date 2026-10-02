/** What a table cell holds after cleaning (Spec §20 OCR prototype). */
export enum OcrCellInk {
  /** No ink left after removing lines and specks. */
  BLANK = 'blank',
  /** A single short horizontal stroke (the roster's "no shift" dash). */
  DASH = 'dash',
  /** Glyphs to read with OCR. */
  TEXT = 'text',
  /** Faint ink, neither clearly blank nor clearly text: not read, left null for the user to confirm. */
  AMBIGUOUS = 'ambiguous',
}
