import { type DayHeader } from '@/domain/types/DayHeader';
import { type RecognitionCandidate } from '@/domain/types/RecognitionCandidate';
import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';

/** GET /api/recognitions/:id/candidates (logged-in owner only). */
export type CandidatesResponse = {
  /** YYYY-MM recognized from the photo, or null when not found. */
  yearMonthGuess: string | null;
  candidates: RecognitionCandidate[];
  definitions: ShiftDefinition[];
  dayHeaders: DayHeader[];
  sourceAvailable: boolean;
};
