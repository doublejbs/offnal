import { type DayHeader } from '@/domain/types/DayHeader';
import { type GridCorners } from '@/domain/types/GridCorners';
import { type RecognitionCandidate } from '@/domain/types/RecognitionCandidate';
import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';

/** First-pass recognition result. Temporary: contains other people's names. */
export type TableRecognition = {
  yearMonth: string | null;
  candidates: RecognitionCandidate[];
  definitions: ShiftDefinition[];
  dayHeaders: DayHeader[];
  /** Day-grid corners for perspective correction (Spec §15). Absent in rows stored before §15. */
  grid?: GridCorners | null;
};
