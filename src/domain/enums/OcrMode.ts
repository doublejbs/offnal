/** Service use of the AI-free OCR reader (Spec §21). `shadow` runs it after the AI result, invisible to users. */
export enum OcrMode {
  OFF = 'off',
  SHADOW = 'shadow',
}
