import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';

/**
 * What the month PNG draws. Entries need only date and code, so both the owner's export data and the
 * public shared-view month can be rendered by the same renderer.
 */
export type PngRenderInput = {
  displayName: string;
  yearMonth: string;
  definitions: ShiftDefinition[];
  entries: { date: string; code: string | null }[];
  /** ISO 8601, printed on the image. */
  generatedAt: string;
};
