import { type TeamRosterFailedRow } from '@/domain/types/api/TeamRosterFailedRow';
import { type TeamRosterProgress } from '@/domain/types/api/TeamRosterProgress';

/**
 * POST .../extract-next: runs the first pass if needed, then claims up to 4 PENDING rows (atomic lease)
 * and reads them. Concurrent calls never process the same row. Repeat while phase is RECOGNIZING/EXTRACTING.
 */
export type ExtractNextResponse = {
  progress: TeamRosterProgress;
  /** Rows this call finished (DONE or FAILED). */
  processedRowIds: string[];
  failedRows: TeamRosterFailedRow[];
};
