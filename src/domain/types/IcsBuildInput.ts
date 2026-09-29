import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';

export type IcsBuildInput = {
  calendarId: string;
  displayName: string;
  yearMonth: string;
  /** Only date and code are read, so share-view entries (no review data) are accepted as is. */
  entries: { date: string; code: string | null }[];
  definitions: ShiftDefinition[];
  includeOff: boolean;
  generatedAt: Date;
  /** Prepended to every event title as `${titlePrefix} · ${label} (${code})` (e.g. the sharer's name). */
  titlePrefix?: string;
  /** Replaces `calendarId` in event UIDs, so a public file does not expose the internal id. */
  uidBase?: string;
  /** Replaces the default `오프날 · {displayName} YYYY년 M월` calendar name. */
  calendarName?: string;
};
