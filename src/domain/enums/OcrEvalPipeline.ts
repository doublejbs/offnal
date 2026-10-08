/** AI-free eval pipelines (Spec §21); `--pipeline` spellings next to the AI `VisionPipelineMode` values. */
export enum OcrEvalPipeline {
  /** OCR only: unresolved cells stay 확인 필요. */
  OCR = 'ocr',
  /** OCR first; a person goes to the warp-strip AI pipeline when OCR cannot finish them. */
  OCR_THEN_AI = 'ocr-then-ai',
}
