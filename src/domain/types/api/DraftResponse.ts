import { type DraftDto } from '@/domain/types/api/DraftDto';
import { type MonthAccessInfo } from '@/domain/types/api/MonthAccessInfo';
import { type PublishBlocker } from '@/domain/types/PublishBlocker';
import { type ReviewSummary } from '@/domain/types/ReviewSummary';
import { type SourceCell } from '@/domain/types/SourceCell';

/** GET/PATCH /api/drafts/:id. Also `details.draft` of a 409 REVISION_CONFLICT. */
export type DraftResponse = {
  draft: DraftDto;
  sourceCells: SourceCell[];
  /** True while the original photo can be shown via GET /api/recognitions/:jobId/source. */
  sourceAvailable: boolean;
  jobId: string | null;
  blockers: PublishBlocker[];
  review: ReviewSummary;
  access: MonthAccessInfo;
};
