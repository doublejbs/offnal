/** How the AI-free reader decided a cell's code (Spec §21). */
export enum OcrCodeSource {
  /** Confident OCR reading that matches the dictionary. */
  OCR = 'ocr',
  /** Glyph shape matches cells of one code in the same table (OCR unsure but not contradicting). */
  GLYPH = 'glyph',
  /** Not decided: blank/dash, or unresolved (shown as 확인 필요). */
  NONE = 'none',
}
