import { ShiftReviewReason } from '@/domain/enums/ShiftReviewReason';
import { type ShiftEntry } from '@/domain/types/ShiftEntry';
import { dayOfDate } from '@/domain/YearMonth';

/**
 * Days the user must confirm: no code (UNREADABLE, MISSING_DATE, DUPLICATE_DATE) or AMBIGUOUS.
 * UNDEFINED_CODE alone is not counted: the code was read, only its times are missing.
 */
export const countReviewEntries = (entries: ShiftEntry[]): number =>
  entries.filter((entry) => entry.code === null || entry.reviewReasons.includes(ShiftReviewReason.AMBIGUOUS))
    .length;

/** Days without any code (the reader could not settle them). */
export const countUnresolvedEntries = (entries: ShiftEntry[]): number =>
  entries.filter((entry) => entry.code === null).length;

/**
 * Days whose final code differs from the initial (AI) draft, matched by day number so a month change
 * (`remapDraftMonth`) does not count every day. A day the AI draft did not have counts when it got a code.
 */
export const countEditedDays = (initial: ShiftEntry[], final: ShiftEntry[]): number => {
  const initialCodeByDay = new Map(initial.map((entry) => [dayOfDate(entry.date), entry.code]));

  return final.filter((entry) => (initialCodeByDay.get(dayOfDate(entry.date)) ?? null) !== entry.code).length;
};
