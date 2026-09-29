import { ShiftReviewReason } from '@/domain/enums/ShiftReviewReason';
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
};

export type WrongCell = {
  date: string;
  expected: string;
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
  /** Non-null codes that differ from the truth. */
  wrongCells: WrongCell[];
  /** Dates left null (needs confirmation) — not counted as wrong values. */
  nullDates: string[];
  /** Correct, non-null codes that were still flagged for review (ambiguous/undefined). */
  flaggedCorrectDays: number;
  undefinedCodeCells: UndefinedCodeCell[];
  /** Legend codes whose times in the final (pass 2) definitions match the truth. */
  definitionsCorrect: number;
};

/** Names compare after NFC and whitespace removal (models sometimes space out Korean names). */
export const normalizeName = (name: string): string => name.normalize('NFC').replace(/\s+/gu, '');

export const findCandidateRowId = (candidates: RecognitionCandidate[], name: string): string | null => {
  const target = normalizeName(name);

  return candidates.find((candidate) => normalizeName(candidate.name) === target)?.rowId ?? null;
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
  const nullDates: string[] = [];
  const undefinedCodeCells: UndefinedCodeCell[] = [];
  let correctDays = 0;
  let flaggedCorrectDays = 0;

  for (const [date, rawExpected] of expectedByDate) {
    const expected = normalizeCode(rawExpected);
    const entry = entryByDate.get(date);
    const got = entry?.code ?? null;

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

    if (got === null) {
      // Missing schedule (name not found / call failed) counts as wrong; a null cell asks the user instead.
      if (schedule === null) {
        wrongCells.push({ date, expected, got: '(none)' });
      } else {
        nullDates.push(date);
      }

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
    nullDates,
    flaggedCorrectDays,
    undefinedCodeCells,
    definitionsCorrect,
  };
};
