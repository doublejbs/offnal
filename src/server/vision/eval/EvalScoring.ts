import { ShiftReviewReason } from '@/domain/enums/ShiftReviewReason';
import { normalizePersonName } from '@/domain/PersonName';
import { normalizeCode } from '@/domain/ScheduleValidator';
import { type NormalizedSchedule } from '@/domain/types/NormalizedSchedule';
import { type RecognitionCandidate } from '@/domain/types/RecognitionCandidate';
import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';
import { type TableRecognition } from '@/domain/types/TableRecognition';
import { type EvalTruth } from '@/server/vision/eval/EvalTruth';

export type DefinitionScore = {
  code: string;
  found: boolean;
  timesMatch: boolean;
};

export type TableScore = {
  yearMonthGuess: string | null;
  yearMonthMatch: boolean;
  namesFound: number;
  namesTotal: number;
  missingNames: string[];
  definitions: DefinitionScore[];
  /** Legend codes found with matching start/end/endsNextDay. */
  definitionsCorrect: number;
  definitionsTotal: number;
  /** Out-of-legend codes pass 1 returned as a defined legend entry (legend absorption, Spec §16). */
  absorbedCodes: string[];
};

export type WrongCell = {
  date: string;
  /** null = the truth cell is blank/unreadable (only reachable when no schedule came back). */
  expected: string | null;
  got: string;
};

/** A code returned where the truth cell is blank/unreadable: the model invented a value. */
export type GuessedCell = {
  date: string;
  got: string;
};

export type UndefinedCodeCell = {
  date: string;
  expected: string;
  got: string | null;
  /** The code was copied as written instead of being guessed as a legend code. */
  kept: boolean;
  /** …and normalizeExtraction flagged it UNDEFINED_CODE for review. */
  flagged: boolean;
};

export type PersonScore = {
  name: string;
  /** Candidate row whose name matched; null means pass 1 missed the name (all days count as wrong). */
  rowId: string | null;
  correctDays: number;
  totalDays: number;
  fullMonthMatch: boolean;
  /** Non-null codes that differ from a non-null truth code. */
  wrongCells: WrongCell[];
  /** Codes returned for truth cells that are blank/unreadable (추측). Not correct, listed separately. */
  guessedCells: GuessedCell[];
  /** Dates with a truth code that came back null (needs confirmation) — not counted as wrong values. */
  nullDates: string[];
  /** Correct, non-null codes that were still flagged for review (ambiguous/undefined). */
  flaggedCorrectDays: number;
  undefinedCodeCells: UndefinedCodeCell[];
  /** Legend codes whose times in the final (pass 2) definitions match the truth. */
  definitionsCorrect: number;
  /** Out-of-legend codes that came back defined (off or with times) in the final definitions. */
  absorbedCodes: string[];
};

export const findCandidateRowId = (candidates: RecognitionCandidate[], name: string): string | null => {
  const target = normalizePersonName(name);

  return candidates.find((candidate) => normalizePersonName(candidate.name) === target)?.rowId ?? null;
};

const scoreDefinitions = (truth: EvalTruth, definitions: ShiftDefinition[]): DefinitionScore[] => {
  const byCode = new Map(definitions.map((definition) => [normalizeCode(definition.code), definition]));

  return Object.entries(truth.definitions).map(([code, expected]) => {
    const got = byCode.get(normalizeCode(code));

    return {
      code,
      found: got !== undefined,
      timesMatch:
        got !== undefined &&
        got.startTime === expected.startTime &&
        got.endTime === expected.endTime &&
        got.endsNextDay === expected.endsNextDay,
    };
  });
};

/**
 * Legend absorption (Spec §16): a code the truth lists as outside the legend came back as a definition that
 * is off or has any time, instead of the time-less placeholder `normalizeExtraction` adds.
 */
export const findAbsorbedCodes = (truth: EvalTruth, definitions: ShiftDefinition[]): string[] => {
  const outsideLegend = new Set(truth.undefinedCodesInTable.map(normalizeCode));

  return definitions
    .filter(
      (definition) =>
        outsideLegend.has(normalizeCode(definition.code)) &&
        (definition.isOff || definition.startTime !== null || definition.endTime !== null),
    )
    .map((definition) => normalizeCode(definition.code));
};

/** Pass 1 score. `table` null means pass 1 failed. */
export const scoreTable = (truth: EvalTruth, table: TableRecognition | null): TableScore => {
  const candidates = table?.candidates ?? [];
  const missingNames = truth.allNames.filter((name) => findCandidateRowId(candidates, name) === null);
  const definitions = scoreDefinitions(truth, table?.definitions ?? []);

  return {
    yearMonthGuess: table?.yearMonth ?? null,
    yearMonthMatch: table?.yearMonth === truth.yearMonth,
    namesFound: truth.allNames.length - missingNames.length,
    namesTotal: truth.allNames.length,
    missingNames,
    definitions,
    definitionsCorrect: definitions.filter((definition) => definition.timesMatch).length,
    definitionsTotal: definitions.length,
    absorbedCodes: findAbsorbedCodes(truth, table?.definitions ?? []),
  };
};

/** Pass 2 score for one truth person against the normalized schedule (null = not extracted). */
export const scorePerson = (
  truth: EvalTruth,
  name: string,
  rowId: string | null,
  schedule: NormalizedSchedule | null,
): PersonScore => {
  const expectedByDate = Object.entries(truth.people[name] ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const entryByDate = new Map((schedule?.entries ?? []).map((entry) => [entry.date, entry]));
  const undefinedCodes = new Set(truth.undefinedCodesInTable.map(normalizeCode));
  const wrongCells: WrongCell[] = [];
  const guessedCells: GuessedCell[] = [];
  const nullDates: string[] = [];
  const undefinedCodeCells: UndefinedCodeCell[] = [];
  let correctDays = 0;
  let flaggedCorrectDays = 0;

  for (const [date, rawExpected] of expectedByDate) {
    const expected = rawExpected === null ? null : normalizeCode(rawExpected);
    const entry = entryByDate.get(date);
    const got = entry?.code ?? null;

    if (schedule === null) {
      // Name not found / call failed: every day counts as wrong, blank truth cells included.
      wrongCells.push({ date, expected, got: '(none)' });

      if (expected !== null && undefinedCodes.has(expected)) {
        undefinedCodeCells.push({ date, expected, got: null, kept: false, flagged: false });
      }

      continue;
    }

    if (expected === null) {
      if (got === null) {
        correctDays += 1;
      } else {
        guessedCells.push({ date, got });
      }

      continue;
    }

    if (undefinedCodes.has(expected)) {
      undefinedCodeCells.push({
        date,
        expected,
        got,
        kept: got === expected,
        flagged:
          got === expected && (entry?.reviewReasons.includes(ShiftReviewReason.UNDEFINED_CODE) ?? false),
      });
    }

    // A null result asks the user to confirm: not correct, but not a wrong value either.
    if (got === null) {
      nullDates.push(date);

      continue;
    }

    if (got !== expected) {
      wrongCells.push({ date, expected, got });

      continue;
    }

    correctDays += 1;

    if (!entry?.confirmed) {
      flaggedCorrectDays += 1;
    }
  }

  const definitionsCorrect = scoreDefinitions(truth, schedule?.definitions ?? []).filter(
    (definition) => definition.timesMatch,
  ).length;

  return {
    name,
    rowId,
    correctDays,
    totalDays: expectedByDate.length,
    fullMonthMatch: expectedByDate.length > 0 && correctDays === expectedByDate.length,
    wrongCells,
    guessedCells,
    nullDates,
    flaggedCorrectDays,
    undefinedCodeCells,
    definitionsCorrect,
    absorbedCodes: findAbsorbedCodes(truth, schedule?.definitions ?? []),
  };
};

/**
 * Extracted codes must match a neighbour this many more discriminating days than the target before the
 * run counts as a neighbour-row read (a model can report the target's name while copying a neighbour).
 */
export const NEIGHBOUR_READ_MARGIN_DAYS = 5;

/** Truth person whose normalized name equals `name`, or null (only scored people have truths). */
const findTruthName = (truth: EvalTruth, name: string): string | null => {
  const target = normalizePersonName(name);

  return Object.keys(truth.people).find((truthName) => normalizePersonName(truthName) === target) ?? null;
};

/**
 * Compares the extracted codes with the truth rows directly above/below (pass-1 order) on the days where
 * that neighbour's code differs from the target's. Null when no neighbour has a truth (not checkable).
 */
export const detectNeighbourRead = (
  truth: EvalTruth,
  name: string,
  neighbourNames: (string | null)[],
  schedule: NormalizedSchedule,
): boolean | null => {
  const expected = truth.people[name] ?? {};
  const gotByDate = new Map(schedule.entries.map((entry) => [entry.date, entry.code]));
  const neighbours = neighbourNames.flatMap((neighbour) => {
    const truthName = neighbour === null ? null : findTruthName(truth, neighbour);

    return truthName === null || truthName === name ? [] : [truth.people[truthName] ?? {}];
  });

  if (neighbours.length === 0) {
    return null;
  }

  const normalizeOrNull = (code: string | null | undefined) => (code ? normalizeCode(code) : null);

  return neighbours.some((neighbour) => {
    let targetMatches = 0;
    let neighbourMatches = 0;

    for (const [date, targetCode] of Object.entries(expected)) {
      const target = normalizeOrNull(targetCode);
      const other = normalizeOrNull(neighbour[date]);
      const got = normalizeOrNull(gotByDate.get(date));

      if (got === null || target === other) {
        continue;
      }

      targetMatches += got === target ? 1 : 0;
      neighbourMatches += got === other ? 1 : 0;
    }

    return neighbourMatches >= targetMatches + NEIGHBOUR_READ_MARGIN_DAYS;
  });
};
