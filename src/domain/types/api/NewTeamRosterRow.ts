import { type ShiftEntry } from '@/domain/types/ShiftEntry';

/** A person added by hand in PATCH (e.g. not in the photo). Status MANUAL. */
export type NewTeamRosterRow = {
  displayName: string;
  /** Whole month; omitted = every date empty (needs review). */
  entries?: ShiftEntry[];
};
