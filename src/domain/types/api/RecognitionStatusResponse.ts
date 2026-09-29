import { type RecognitionErrorCode } from '@/domain/enums/RecognitionErrorCode';
import { type RecognitionStatus } from '@/domain/enums/RecognitionStatus';

/**
 * GET /api/recognitions/:id/status, POST .../process and POST .../claim.
 * Never contains names, codes or the year-month (safe before login).
 */
export type RecognitionStatusResponse = {
  id: string;
  status: RecognitionStatus;
  errorCode: RecognitionErrorCode | null;
  /** True when `POST .../process` may be called again after a failure. */
  retryable: boolean;
  /** ISO 8601 */
  expiresAt: string;
  /** True when the viewer is logged in (the blur gate is skipped; claim then select). */
  ownerAuthenticated: boolean;
};
