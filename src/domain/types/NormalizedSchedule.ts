import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';
import { type ShiftEntry } from '@/domain/types/ShiftEntry';
import { type SourceCell } from '@/domain/types/SourceCell';

export type NormalizedSchedule = {
  entries: ShiftEntry[];
  definitions: ShiftDefinition[];
  sourceCells: SourceCell[];
};
