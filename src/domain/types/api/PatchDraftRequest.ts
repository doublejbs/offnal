import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';
import { type ShiftEntry } from '@/domain/types/ShiftEntry';

/**
 * PATCH /api/drafts/:id body. When `yearMonth` changes without `entries`, the server remaps the
 * current entries by day number; when `entries` is sent it must cover exactly the (new) month.
 */
export type PatchDraftRequest = {
  revision: number;
  displayName?: string;
  yearMonth?: string;
  entries?: ShiftEntry[];
  definitions?: ShiftDefinition[];
};
