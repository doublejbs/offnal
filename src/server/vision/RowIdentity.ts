import { normalizePersonName } from '@/domain/PersonName';
import { type RecognitionCandidate } from '@/domain/types/RecognitionCandidate';
import { type PersonExtractionInput, type RowContext, type RowReading } from '@/server/vision/VisionProvider';

/** Neighbour names and same-name ordinal of `rowId` in pass-1 order, or null when the row is unknown. */
export const buildRowContext = (candidates: RecognitionCandidate[], rowId: string): RowContext | null => {
  const index = candidates.findIndex((candidate) => candidate.rowId === rowId);
  const target = candidates[index];

  if (!target) {
    return null;
  }

  const key = normalizePersonName(target.name);
  const sameName = candidates.filter((candidate) => normalizePersonName(candidate.name) === key);

  return {
    sameNameOrdinal: sameName.findIndex((candidate) => candidate.rowId === rowId) + 1,
    sameNameCount: sameName.length,
    above: candidates[index - 1]?.name ?? null,
    below: candidates[index + 1]?.name ?? null,
  };
};

export const matchesTargetName = (rowName: string | null, targetName: string): boolean =>
  rowName !== null && normalizePersonName(rowName) === normalizePersonName(targetName);

/**
 * A strip reading counts only when the model says the target is in the strip, the name it read matches,
 * and — for duplicate names — it picked the same ordinal as pass 1.
 */
export const isStripReadingVerified = (
  reading: RowReading | undefined,
  input: PersonExtractionInput,
): boolean => {
  if (!reading || reading.targetInStrip !== true || !matchesTargetName(reading.rowName, input.name)) {
    return false;
  }

  const context = input.rowContext;

  return !context || context.sameNameCount <= 1 || reading.sameNameOrdinal === context.sameNameOrdinal;
};
