import { type RecognitionErrorCode } from '@/domain/enums/RecognitionErrorCode';
import { type RosterRowExtractStatus } from '@/domain/enums/RosterRowExtractStatus';
import { type PublishBlocker } from '@/domain/types/PublishBlocker';
import { type ShiftEntry } from '@/domain/types/ShiftEntry';
import { type SourceCell } from '@/domain/types/SourceCell';

/** One person row in the admin's full roster view (review data included — admins only). */
export type TeamRosterRowDto = {
  id: string;
  rowKey: string;
  displayName: string;
  sameNameOrdinal: number;
  sameNameCount: number;
  position: number;
  entries: ShiftEntry[];
  /** Raw cell text read from the photo (comparison). Empty for manual rows. */
  sourceCells: SourceCell[];
  excluded: boolean;
  extractStatus: RosterRowExtractStatus;
  attemptCount: number;
  extractErrorCode: RecognitionErrorCode | null;
  /** Dates still needing review. */
  reviewCount: number;
  /** Publish blockers of this row with the roster's definitions (empty when excluded). */
  blockers: PublishBlocker[];
  /** Active member linked to this row. */
  linkedMember: { userId: string; displayName: string } | null;
  /** No row with this key in the latest published revision (new person — or renamed, see `matchRowKey`). */
  isNewPerson: boolean;
};
