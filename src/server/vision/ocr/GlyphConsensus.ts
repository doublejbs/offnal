import { OcrCodeSource } from '@/domain/enums/OcrCodeSource';
import { isCodeShaped } from '@/server/vision/ocr/CodeDictionary';
import { compareGlyphs, type GlyphDescriptor } from '@/server/vision/ocr/GlyphDescriptor';

/** A text cell entering the consensus: its glyph shape and what OCR made of it. */
export type ConsensusCell = {
  descriptor: GlyphDescriptor | null;
  /** Confident dictionary code from OCR, or null. */
  code: string | null;
  /** Normalized OCR token (may be empty or junk). */
  token: string;
};

export type ConsensusDecision = { code: string | null; source: OcrCodeSource };

export type ConsensusResult = { decisions: ConsensusDecision[]; dictionary: string[] };

/** A glyph within this distance of a code's nearest exemplar may take that code. */
export const MATCH_MAX_DISTANCE = 0.15;
/** …only when the runner-up code is at least this many times and this much farther away. */
export const MATCH_MIN_RATIO = 2;
export const MATCH_MIN_GAP = 0.08;
/** New codes: every cell of the group within this distance of the group's medoid… */
export const GROUP_MAX_DISTANCE = 0.15;
/** …and at least this far from every existing code's exemplars. */
export const GROUP_MIN_SEPARATION = 0.25;

/** "WW" → "W": a wide letter read twice. Only used to group readings, never to match codes. */
export const collapseRepeats = (token: string): string =>
  token.length === 2 && token[0] === token[1] ? token[0]! : token;

type Distances = Map<string, number>;

/** Nearest exemplar distance per code (leave-one-out: the cell itself is skipped). */
const nearestByCode = (cells: ConsensusCell[], labels: (string | null)[], index: number): Distances => {
  const distances: Distances = new Map();
  const own = cells[index]!.descriptor;

  if (!own) {
    return distances;
  }

  cells.forEach((other, otherIndex) => {
    const label = labels[otherIndex];

    if (otherIndex === index || label === null || label === undefined || !other.descriptor) {
      return;
    }

    const distance = compareGlyphs(own, other.descriptor);

    if (distance < (distances.get(label) ?? Number.POSITIVE_INFINITY)) {
      distances.set(label, distance);
    }
  });

  return distances;
};

const rank = (distances: Distances): { code: string; distance: number; runnerUp: number } | null => {
  const sorted = [...distances.entries()].sort(([, a], [, b]) => a - b);
  const [first, second] = sorted;

  return first
    ? { code: first[0], distance: first[1], runnerUp: second?.[1] ?? Number.POSITIVE_INFINITY }
    : null;
};

const isClearMatch = (ranked: { distance: number; runnerUp: number }): boolean =>
  ranked.distance <= MATCH_MAX_DISTANCE &&
  ranked.runnerUp >= ranked.distance * MATCH_MIN_RATIO &&
  ranked.runnerUp - ranked.distance >= MATCH_MIN_GAP;

/**
 * Codes that OCR read consistently but never confidently (W in a photo): unresolved cells sharing one
 * code-shaped token whose glyphs agree with each other and differ from every known code.
 */
const discoverCodes = (cells: ConsensusCell[], labels: (string | null)[], dictionary: Set<string>): void => {
  const groups = new Map<string, number[]>();

  cells.forEach((cell, index) => {
    const token = collapseRepeats(cell.token);

    if (labels[index] === null && cell.descriptor && isCodeShaped(token) && !dictionary.has(token)) {
      groups.set(token, [...(groups.get(token) ?? []), index]);
    }
  });

  for (const [token, members] of groups) {
    if (members.length < 2) {
      continue;
    }

    const descriptors = members.map((index) => cells[index]!.descriptor!);
    const medoid = descriptors.reduce((best, candidate) =>
      descriptors.reduce((sum, other) => sum + compareGlyphs(candidate, other), 0) <
      descriptors.reduce((sum, other) => sum + compareGlyphs(best, other), 0)
        ? candidate
        : best,
    );
    const cohesive = descriptors.every(
      (descriptor) => compareGlyphs(descriptor, medoid) <= GROUP_MAX_DISTANCE,
    );
    const separated = members.every((index) => {
      const nearest = rank(nearestByCode(cells, labels, index));

      return nearest === null || nearest.distance >= GROUP_MIN_SEPARATION;
    });

    if (cohesive && separated) {
      dictionary.add(token);
      members.forEach((index) => {
        labels[index] = token;
      });
    }
  }
};

/**
 * In-table glyph consensus (Spec §20 iteration): one photo prints every code in the same font, so cells
 * OCR read confidently are exemplars for the rest. An unsure cell takes a code only when its glyphs are
 * clearly closest to that code's exemplars and OCR did not read another dictionary code; a confident OCR
 * code whose glyphs clearly look like another code is withdrawn (확인 필요) rather than trusted.
 */
export const resolveByConsensus = (cells: ConsensusCell[], dictionaryCodes: string[]): ConsensusResult => {
  const dictionary = new Set(dictionaryCodes);
  const ocrLabels = cells.map((cell) => cell.code);
  const labels = [...ocrLabels];

  discoverCodes(cells, labels, dictionary);

  const decisions = cells.map((cell, index): ConsensusDecision => {
    const label = labels[index] ?? null;

    if (label !== null) {
      const ranked = ocrLabels[index] !== null ? rank(nearestByCode(cells, ocrLabels, index)) : null;
      const contradicted = ranked !== null && ranked.code !== label && isClearMatch(ranked);

      return contradicted
        ? { code: null, source: OcrCodeSource.NONE }
        : { code: label, source: ocrLabels[index] !== null ? OcrCodeSource.OCR : OcrCodeSource.GLYPH };
    }

    const ranked = rank(nearestByCode(cells, labels, index));
    const readsOtherCode = dictionary.has(cell.token) && cell.token !== ranked?.code;

    if (ranked && isClearMatch(ranked) && !readsOtherCode) {
      return { code: ranked.code, source: OcrCodeSource.GLYPH };
    }

    return { code: null, source: OcrCodeSource.NONE };
  });

  return { decisions, dictionary: [...dictionary].sort() };
};
