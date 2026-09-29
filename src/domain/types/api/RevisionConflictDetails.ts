import { type RevisionConflictReason } from '@/domain/enums/RevisionConflictReason';
import { type DraftResponse } from '@/domain/types/api/DraftResponse';

/** `error.details` of every 409 REVISION_CONFLICT (PATCH and publish). */
export type RevisionConflictDetails = {
  reason: RevisionConflictReason;
  /** Current stored revision of the draft. */
  currentRevision: number;
  /** Current published revision of the month (STALE_BASE only). */
  publishedRevision?: number;
  /** Latest draft state, included when the caller can reload it directly. */
  draft?: DraftResponse;
};
