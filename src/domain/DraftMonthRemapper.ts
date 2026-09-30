import { ShiftReviewReason } from '@/domain/enums/ShiftReviewReason';
import { type ShiftEntry } from '@/domain/types/ShiftEntry';
import { dayOfDate, listDates } from '@/domain/YearMonth';

/** Moves entries to another month by day number; missing days become MISSING_DATE. */
export const remapDraftMonth = (
  entries: ShiftEntry[],
  fromYearMonth: string,
  toYearMonth: string,
): ShiftEntry[] => {
  const sourceDates = new Set(listDates(fromYearMonth));
  const entryByDay = new Map<number, ShiftEntry>();

  for (const entry of entries) {
    if (sourceDates.has(entry.date) && !entryByDay.has(dayOfDate(entry.date))) {
      entryByDay.set(dayOfDate(entry.date), entry);
    }
  }

  return listDates(toYearMonth).map((date) => {
    const source = entryByDay.get(dayOfDate(date));

    if (!source) {
      return { date, code: null, reviewReasons: [ShiftReviewReason.MISSING_DATE], confirmed: false };
    }

    return { ...source, reviewReasons: [...source.reviewReasons], date };
  });
};

export const buildEmptyEntries = (yearMonth: string): ShiftEntry[] =>
  listDates(yearMonth).map((date) => ({
    date,
    code: null,
    reviewReasons: [ShiftReviewReason.MISSING_DATE],
    confirmed: false,
  }));
