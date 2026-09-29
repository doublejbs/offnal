import { type DraftStatus } from '@/domain/enums/DraftStatus';
import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';
import { type ShiftEntry } from '@/domain/types/ShiftEntry';

export type DraftDto = {
  id: string;
  status: DraftStatus;
  revision: number;
  /** YYYY-MM */
  yearMonth: string;
  displayName: string;
  definitions: ShiftDefinition[];
  entries: ShiftEntry[];
  /** ISO 8601 */
  updatedAt: string;
  /** ISO 8601 */
  expiresAt: string;
};
