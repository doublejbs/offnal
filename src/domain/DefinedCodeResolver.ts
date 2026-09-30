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

/**
 * Codes the draft screen lists as "처음 보는 코드": used by an entry while their definition is missing or
 * incomplete, or still flagged UNDEFINED_CODE. Each once, in date order. Server-side resolution is one-way
 * (UNDEFINED_CODE never comes back), so this is based on the definition: un-checking 휴무 or clearing a
 * time brings the code back here, and publishing stays blocked by MISSING_TIMES meanwhile.
 */
export const listUnresolvedCodes = (entries: ShiftEntry[], definitions: ShiftDefinition[]): string[] => {
  const definitionByCode = new Map(definitions.map((definition) => [definition.code, definition]));
  const codes = [...entries]
    .sort((left, right) => left.date.localeCompare(right.date))
    .flatMap((entry) => {
      if (entry.code === null) {
        return [];
      }

      const definition = definitionByCode.get(entry.code);
      const isUnresolved =
        entry.reviewReasons.includes(ShiftReviewReason.UNDEFINED_CODE) ||
        definition === undefined ||
        !hasCompleteTimes(definition);

      return isUnresolved ? [entry.code] : [];
    });

  return [...new Set(codes)];
};
