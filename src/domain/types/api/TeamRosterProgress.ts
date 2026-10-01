import { type RecognitionErrorCode } from '@/domain/enums/RecognitionErrorCode';
import { type TeamRosterPhase } from '@/domain/enums/TeamRosterPhase';

/** Real progress of a roster's whole-team extraction ("12/18명 읽는 중" = done+manual / total). */
export type TeamRosterProgress = {
  phase: TeamRosterPhase;
  /** Rows that are not excluded. */
  total: number;
  done: number;
  manual: number;
  failed: number;
  pending: number;
  processing: number;
  excluded: number;
  /** First-pass failure code (phase RECOGNITION_FAILED), else null. */
  recognitionErrorCode: RecognitionErrorCode | null;
  /** Phase RECOGNITION_FAILED: extract-next will retry the first pass. */
  retryable: boolean;
  /** FAILED rows that `extract-next` with `retryFailed: true` would retry (attempts < 3). */
  retryableRowCount: number;
};
