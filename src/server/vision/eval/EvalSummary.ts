import { VisionEvalFailureKind } from '@/domain/enums/VisionEvalFailureKind';
import { VisionEvalPersonOutcome } from '@/domain/enums/VisionEvalPersonOutcome';
import { VisionEvalStatus } from '@/domain/enums/VisionEvalStatus';
import { VisionPipelineMode } from '@/domain/enums/VisionPipelineMode';
import { type CallRecord, type EvalRun, type PersonRun } from '@/server/vision/eval/EvalTypes';

export type ModelSummary = {
  model: string;
  pipeline: VisionPipelineMode;
  /** Set for per-sample summaries, null for totals. */
  sampleId: string | null;
  runs: number;
  okRuns: number;
  /** okRuns / runs. */
  successRate: number | null;
  /** Model-attributable failures (pass-1 no_table/unreadable/no_names, MAX_TOKENS, blocked, invalid JSON/schema). */
  modelFailures: number;
  /** Infrastructure failures (429 after retries, 5xx, timeouts, network): excluded from both accuracies. */
  infraFailures: number;
  skipped: string | null;
  /**
   * End-to-end: correct days / days of every person not lost to infrastructure. Model failures score 0.
   * This is the ranking metric.
   */
  endToEndAccuracy: number | null;
  endToEndCorrectDays: number;
  endToEndDays: number;
  /** Correct days / scored days over fully successful runs only (null cells count as not correct). */
  accuracy: number | null;
  correctDays: number;
  scoredDays: number;
  fullMonthMatches: number;
  personRuns: number;
  wrongCells: number;
  /** Codes returned where the truth cell is blank/unreadable (추측). */
  guessedCells: number;
  nullCells: number;
  flaggedCorrect: number;
  undefinedKept: number;
  undefinedFlagged: number;
  undefinedTotal: number;
  yearMonthMatches: number;
  namesFound: number;
  namesTotal: number;
  definitionsCorrect: number;
  definitionsTotal: number;
  pass1LatencyMs: number | null;
  /** Average pass-2 time of one person = every pass-2 call (locate + extract). */
  pass2LatencyMs: number | null;
  /** Average provider calls of one upload = pass 1 + one person's pass-2 calls. */
  callsPerUpload: number | null;
  /** Pass-2 input actually used (route → persons), over fully successful runs. */
  routes: Record<string, number>;
  /** Fallback reasons (reason → persons), over fully successful runs. */
  fallbacks: Record<string, number>;
  /** Persons whose row the model did not confirm by reading the name back (fully successful runs). */
  unverifiedRows: number;
  /** Persons whose cells clearly match a neighbouring truth row instead of theirs / persons checkable. */
  neighbourReads: number;
  neighbourChecks: number;
  /** Average tokens of one upload = pass 1 + one pass 2. */
  uploadInputTokens: number | null;
  uploadOutputTokens: number | null;
  uploadThinkingTokens: number | null;
  /** Estimated paid-tier USD of one upload = pass 1 + one pass 2. */
  uploadCostUsd: number | null;
  /** `sample/name` → correct days per OK run (in run order). */
  perPerson: Record<string, number[]>;
};

const average = (values: number[]): number | null =>
  values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;

const sumOrNull = (a: number | null, b: number | null): number | null =>
  a === null || b === null ? null : a + b;

const okCalls = (calls: (CallRecord | null)[]): CallRecord[] =>
  calls.filter((call): call is CallRecord => call !== null && call.ok);

const sumUsage = (calls: CallRecord[], pick: (call: CallRecord) => number | null): number | null =>
  calls.reduce<number | null>((sum, call) => sumOrNull(sum, call.ok ? pick(call) : 0), 0);

/** One person's pass 2 as a single record: latency of every call, usage/cost of the successful ones. */
const aggregatePersonCalls = (person: PersonRun): CallRecord => ({
  ok: true,
  latencyMs: person.calls.reduce((sum, call) => sum + call.latencyMs, 0),
  retries: person.calls.reduce((sum, call) => sum + call.retries, 0),
  usage: {
    inputTokens: sumUsage(person.calls, (call) => call.usage?.inputTokens ?? null) ?? 0,
    outputTokens: sumUsage(person.calls, (call) => call.usage?.outputTokens ?? null) ?? 0,
    thinkingTokens: sumUsage(person.calls, (call) => call.usage?.thinkingTokens ?? null),
  },
  costUsd: sumUsage(person.calls, (call) => call.costUsd),
  error: null,
  failureKind: null,
});

/** Names repeat across samples (same ward, different months), so people are keyed per sample. */
export const personKey = (sampleId: string, name: string): string => `${sampleId}/${name}`;

const countBy = (values: (string | null)[]): Record<string, number> => {
  const counts: Record<string, number> = {};

  for (const value of values) {
    if (value !== null) {
      counts[value] = (counts[value] ?? 0) + 1;
    }
  }

  return counts;
};

export const summarizeModel = (
  model: string,
  runs: EvalRun[],
  skipped: string | null,
  pipeline: VisionPipelineMode = VisionPipelineMode.BASELINE,
  sampleId: string | null = null,
): ModelSummary => {
  const ok = runs.filter((run) => run.status === VisionEvalStatus.OK);
  const okPeople = ok.flatMap((run) => run.people);
  const people = okPeople.map((person) => person.score);
  const tables = ok.flatMap((run) => (run.table ? [run.table] : []));
  const pass1 = okCalls(ok.map((run) => run.tableCall));
  const pass2People = okPeople.filter((person) => person.calls.length > 0);
  const pass2 = pass2People.map(aggregatePersonCalls);
  const endToEnd = runs.flatMap((run) =>
    run.people.flatMap((person) =>
      person.outcome === VisionEvalPersonOutcome.INFRA_FAILURE ? [] : [person.score],
    ),
  );
  const endToEndCorrectDays = endToEnd.reduce((sum, person) => sum + person.correctDays, 0);
  const endToEndDays = endToEnd.reduce((sum, person) => sum + person.totalDays, 0);
  const failureKinds = runs.flatMap((run) => {
    const pass1Kind = run.error?.startsWith('pass1') ? [run.failureKind] : [];
    const pass2Kinds = run.people.flatMap((person) =>
      person.call && !person.call.ok ? [person.call.failureKind] : [],
    );

    return [...pass1Kind, ...pass2Kinds];
  });
  const correctDays = people.reduce((sum, person) => sum + person.correctDays, 0);
  const scoredDays = people.reduce((sum, person) => sum + person.totalDays, 0);
  const undefinedCells = people.flatMap((person) => person.undefinedCodeCells);
  const perPerson: Record<string, number[]> = {};
  const tokens = (calls: CallRecord[], pick: (call: CallRecord) => number | null) =>
    average(
      calls.flatMap((call) => {
        const value = pick(call);

        return value === null ? [] : [value];
      }),
    );

  for (const run of ok) {
    for (const { score } of run.people) {
      const key = personKey(run.sampleId, score.name);

      perPerson[key] = [...(perPerson[key] ?? []), score.correctDays];
    }
  }

  const pass2CallCount = average(pass2People.map((person) => person.calls.length));

  return {
    model,
    pipeline,
    sampleId,
    runs: runs.length,
    okRuns: ok.length,
    successRate: runs.length === 0 ? null : ok.length / runs.length,
    modelFailures: failureKinds.filter((kind) => kind === VisionEvalFailureKind.MODEL).length,
    infraFailures: failureKinds.filter((kind) => kind !== VisionEvalFailureKind.MODEL).length,
    skipped,
    endToEndAccuracy: endToEndDays === 0 ? null : endToEndCorrectDays / endToEndDays,
    endToEndCorrectDays,
    endToEndDays,
    accuracy: scoredDays === 0 ? null : correctDays / scoredDays,
    correctDays,
    scoredDays,
    fullMonthMatches: people.filter((person) => person.fullMonthMatch).length,
    personRuns: people.length,
    wrongCells: people.reduce((sum, person) => sum + person.wrongCells.length, 0),
    guessedCells: people.reduce((sum, person) => sum + person.guessedCells.length, 0),
    nullCells: people.reduce((sum, person) => sum + person.nullDates.length, 0),
    flaggedCorrect: people.reduce((sum, person) => sum + person.flaggedCorrectDays, 0),
    undefinedKept: undefinedCells.filter((cell) => cell.kept).length,
    undefinedFlagged: undefinedCells.filter((cell) => cell.flagged).length,
    undefinedTotal: undefinedCells.length,
    yearMonthMatches: tables.filter((table) => table.yearMonthMatch).length,
    namesFound: tables.reduce((sum, table) => sum + table.namesFound, 0),
    namesTotal: tables.reduce((sum, table) => sum + table.namesTotal, 0),
    definitionsCorrect: tables.reduce((sum, table) => sum + table.definitionsCorrect, 0),
    definitionsTotal: tables.reduce((sum, table) => sum + table.definitionsTotal, 0),
    pass1LatencyMs: average(pass1.map((call) => call.latencyMs)),
    pass2LatencyMs: average(pass2.map((call) => call.latencyMs)),
    callsPerUpload: pass1.length === 0 || pass2CallCount === null ? null : 1 + pass2CallCount,
    routes: countBy(okPeople.map((person) => person.route)),
    fallbacks: countBy(okPeople.map((person) => person.fallback)),
    unverifiedRows: okPeople.filter((person) => person.identityVerified === false).length,
    neighbourReads: okPeople.filter((person) => person.neighbourRead === true).length,
    neighbourChecks: okPeople.filter((person) => person.neighbourRead !== null).length,
    uploadInputTokens: sumOrNull(
      tokens(pass1, (call) => call.usage?.inputTokens ?? null),
      tokens(pass2, (call) => call.usage?.inputTokens ?? null),
    ),
    uploadOutputTokens: sumOrNull(
      tokens(pass1, (call) => call.usage?.outputTokens ?? null),
      tokens(pass2, (call) => call.usage?.outputTokens ?? null),
    ),
    uploadThinkingTokens: sumOrNull(
      tokens(pass1, (call) => call.usage?.thinkingTokens ?? null),
      tokens(pass2, (call) => call.usage?.thinkingTokens ?? null),
    ),
    uploadCostUsd: sumOrNull(
      tokens(pass1, (call) => call.costUsd),
      tokens(pass2, (call) => call.costUsd),
    ),
    perPerson,
  };
};

/** Highest end-to-end accuracy first; ties (and unknown accuracy last) by cheaper upload. */
export const sortSummaries = (summaries: ModelSummary[]): ModelSummary[] =>
  [...summaries].sort(
    (a, b) =>
      (b.endToEndAccuracy ?? -1) - (a.endToEndAccuracy ?? -1) ||
      (a.uploadCostUsd ?? Number.POSITIVE_INFINITY) - (b.uploadCostUsd ?? Number.POSITIVE_INFINITY),
  );
