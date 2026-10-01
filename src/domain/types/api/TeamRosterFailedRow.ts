import { type RecognitionErrorCode } from '@/domain/enums/RecognitionErrorCode';

/** A row whose extraction failed. */
export type TeamRosterFailedRow = {
  rowId: string;
  displayName: string;
  attemptCount: number;
  errorCode: RecognitionErrorCode | null;
  /** Attempts left (max 3) and the error can be fixed by retrying. */
  retryable: boolean;
};
