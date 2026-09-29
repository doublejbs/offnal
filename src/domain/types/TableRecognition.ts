import { type DayHeader } from '@/domain/types/DayHeader';
import { type RecognitionCandidate } from '@/domain/types/RecognitionCandidate';
import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';

/** First-pass recognition result. Temporary: contains other people's names. */
export type TableRecognition = {
  yearMonth: string | null;
  candidates: RecognitionCandidate[];
  definitions: ShiftDefinition[];
  dayHeaders: DayHeader[];
};
