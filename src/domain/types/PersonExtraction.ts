import { type ExtractedCell } from '@/domain/types/ExtractedCell';
import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';

/** Raw second-pass output for one selected row. */
export type PersonExtraction = {
  yearMonth: string;
  rowId: string;
  displayName: string;
  definitions: ShiftDefinition[];
  cells: ExtractedCell[];
};
