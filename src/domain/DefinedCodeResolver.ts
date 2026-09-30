import { ShiftReviewReason } from '@/domain/enums/ShiftReviewReason';
import { hasCompleteTimes } from '@/domain/ShiftTime';
import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';
import { type ShiftEntry } from '@/domain/types/ShiftEntry';

/**
 * Spec §16: once a code outside the legend gets a complete definition (off, or valid start/end/next-day),
 * every entry using it drops UNDEFINED_CODE. Other reasons stay; an entry is confirmed only when no reason
 * is left and it has a code. Entries that do not change are returned as the same objects.
 */
export const resolveDefinedCodes = (entries: ShiftEntry[], definitions: ShiftDefinition[]): ShiftEntry[] => {
  const definedCodes = new Set(
    definitions.filter((definition) => hasCompleteTimes(definition)).map((definition) => definition.code),
  );

  return entries.map((entry) => {
    if (
      entry.code === null ||
      !definedCodes.has(entry.code) ||
      !entry.reviewReasons.includes(ShiftReviewReason.UNDEFINED_CODE)
    ) {
      return entry;
    }

    const reviewReasons = entry.reviewReasons.filter((reason) => reason !== ShiftReviewReason.UNDEFINED_CODE);

    return { ...entry, reviewReasons, confirmed: reviewReasons.length === 0 };
  });
};

/** Codes still flagged UNDEFINED_CODE, each once, in date order (the "처음 보는 코드" warning). */
export const listUndefinedCodes = (entries: ShiftEntry[]): string[] => {
  const codes = entries
    .filter((entry) => entry.reviewReasons.includes(ShiftReviewReason.UNDEFINED_CODE))
    .sort((left, right) => left.date.localeCompare(right.date))
    .flatMap((entry) => (entry.code === null ? [] : [entry.code]));

  return [...new Set(codes)];
};
