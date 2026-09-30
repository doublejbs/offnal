/** POST /api/recognitions/:id/extract. Same draftId on retry (idempotent). */
export type ExtractRecognitionResponse = {
  draftId: string;
};
