/** POST /api/recognitions/:id/extract body: either a recognized row or a manually typed name. */
export type ExtractRecognitionRequest =
  { rowId: string; yearMonth: string } | { manualName: string; yearMonth: string };
