import { type ShiftCodeEntry } from '@/domain/types/ShiftCodeEntry';

/** One person of the published roster as members see it: name, dates and codes only. */
export type TeamRosterViewRow = {
  rowKey: string;
  displayName: string;
  sameNameOrdinal: number;
  sameNameCount: number;
  entries: ShiftCodeEntry[];
  /** The viewer's linked row (highlight). */
  isMine: boolean;
};
