import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';
import { type ShiftEntry } from '@/domain/types/ShiftEntry';

export type IcsBuildInput = {
  calendarId: string;
  displayName: string;
  yearMonth: string;
  entries: ShiftEntry[];
  definitions: ShiftDefinition[];
  includeOff: boolean;
  generatedAt: Date;
};
