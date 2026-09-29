/** POST /api/drafts/:id/publish. Re-publishing the same draft returns the same shape (idempotent). */
export type PublishDraftResponse = {
  draftId: string;
  /** YYYY-MM */
  yearMonth: string;
  /** Revision of the published month after this publish. */
  publishedRevision: number;
  /** True only when this request consumed a free month. */
  usedTrial: boolean;
  alreadyPublished: boolean;
};
