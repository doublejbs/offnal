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

export const hasDuplicateName = (input: PersonExtractionInput): boolean =>
  (input.rowContext?.sameNameCount ?? 0) > 1;

type VerifyOptions = {
  /** Strip readings must also confirm the target is visible in the strip. */
  requireInStrip: boolean;
};

/**
 * A reading counts only when the name it read back matches the target, for duplicate names the
 * occurrence it reports (the prompt never reveals the expected one) equals pass 1's, and — for strips —
 * the model says the target is in the strip.
 */
export const isReadingVerified = (
  reading: RowReading | undefined,
  input: PersonExtractionInput,
  options: VerifyOptions,
): boolean => {
  if (!reading || !matchesTargetName(reading.rowName, input.name)) {
    return false;
  }

  if (options.requireInStrip && reading.targetInStrip !== true) {
    return false;
  }

  return !hasDuplicateName(input) || reading.sameNameOrdinal === input.rowContext?.sameNameOrdinal;
};
