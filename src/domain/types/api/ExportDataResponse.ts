import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';
import { type ShiftEntry } from '@/domain/types/ShiftEntry';

/** GET /api/calendar/:yearMonth/export-data — entitlement-checked data for the PNG renderer. */
export type ExportDataResponse = {
  displayName: string;
  yearMonth: string;
  definitions: ShiftDefinition[];
  entries: ShiftEntry[];
  /** ISO 8601, server time of this response (printed on the image). */
  generatedAt: string;
  /** ISO 8601, last publish of this month. */
  updatedAt: string;
  /** Team name when the month comes from a team roster, else null. */
  teamName: string | null;
};
