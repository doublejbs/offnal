import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';
import { type ShiftEntry } from '@/domain/types/ShiftEntry';
import { type WorkOffCounts } from '@/domain/types/WorkOffCounts';

/** Counts dates with a defined work code vs. a defined off code (unknown/empty codes are skipped). */
export const countWorkAndOff = (entries: ShiftEntry[], definitions: ShiftDefinition[]): WorkOffCounts => {
  const definitionByCode = new Map(definitions.map((definition) => [definition.code, definition]));
  let workCount = 0;
  let offCount = 0;

  for (const entry of entries) {
    const definition = entry.code === null ? undefined : definitionByCode.get(entry.code);

    if (!definition) {
      continue;
    }

    if (definition.isOff) {
      offCount += 1;
    } else {
      workCount += 1;
    }
  }

  return { workCount, offCount };
};
