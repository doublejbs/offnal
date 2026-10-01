import { type RevisionConflictReason } from '@/domain/enums/RevisionConflictReason';
import { type TeamRosterResponse } from '@/domain/types/api/TeamRosterResponse';

/** `error.details` of a 409 REVISION_CONFLICT from roster PATCH/publish. */
export type TeamRosterConflictDetails = {
  /** STALE_REVISION: `version` is old. STALE_BASE: a newer revision was published after this draft was made. */
  reason: RevisionConflictReason;
  currentVersion: number;
  /** Latest published revision of the month (STALE_BASE). */
  publishedRevision?: number;
  /** Current roster (PATCH conflicts) to reload. */
  roster?: TeamRosterResponse;
};
