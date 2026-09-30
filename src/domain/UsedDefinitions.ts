import { type ShiftCodeEntry } from '@/domain/types/ShiftCodeEntry';
import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';

/** Definitions whose code appears in the entries, in definition order (legends, time summaries). */
export const filterUsedDefinitions = (
  definitions: ShiftDefinition[],
  entries: ShiftCodeEntry[],
): ShiftDefinition[] => {
  const usedCodes = new Set(entries.map((entry) => entry.code));

  return definitions.filter((definition) => usedCodes.has(definition.code));
};
