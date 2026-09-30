import { VisionEvalFailureKind } from '@/domain/enums/VisionEvalFailureKind';
import { VisionEvalPersonOutcome } from '@/domain/enums/VisionEvalPersonOutcome';
import { VisionEvalStatus } from '@/domain/enums/VisionEvalStatus';
import { VisionPipelineMode } from '@/domain/enums/VisionPipelineMode';
import { type CallRecord, type EvalRun, type PersonRun } from '@/server/vision/eval/EvalRunner';

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

/** Display width with East Asian wide characters counted as 2 columns. */
const displayWidth = (text: string): number =>
  [...text].reduce((width, char) => width + ((char.codePointAt(0) ?? 0) >= 0x1100 ? 2 : 1), 0);

const pad = (text: string, width: number): string =>
  text + ' '.repeat(Math.max(0, width - displayWidth(text)));

export const formatTable = (header: string[], rows: string[][]): string => {
  const widths = header.map((title, index) =>
    Math.max(displayWidth(title), ...rows.map((row) => displayWidth(row[index] ?? ''))),
  );
  const line = (cells: string[]) => cells.map((cell, index) => pad(cell, widths[index] ?? 0)).join(' | ');

  return [line(header), widths.map((width) => '-'.repeat(width)).join('-|-'), ...rows.map(line)].join('\n');
};

const formatPercent = (value: number | null): string =>
  value === null ? '-' : `${(value * 100).toFixed(1)}%`;

const formatNumber = (value: number | null): string => (value === null ? '-' : Math.round(value).toString());

const formatSeconds = (ms: number | null): string => (ms === null ? '-' : `${(ms / 1000).toFixed(1)}s`);

const formatUsd = (value: number | null): string => (value === null ? '-' : `$${value.toFixed(4)}`);

/** `strip 9, warped 1` (sorted by count). */
export const formatCounts = (counts: Record<string, number>): string =>
  Object.entries(counts)
    .sort(([, a], [, b]) => b - a)
    .map(([key, count]) => `${key} ${count}`)
    .join(', ') || '-';

const SUMMARY_HEADER = [
  'pipeline',
  'model',
  'success',
  'e2e accuracy',
  'accuracy (ok runs)',
  'full month',
  'wrong',
  '추측',
  'null',
  'W kept/flag',
  'month',
  'names',
  'legend',
  'p1',
  'p2',
  'calls/upload',
  'p2 input',
  'tok in/out/think per upload',
  '$/upload',
  '$/1k uploads',
  'model fail',
  'infra fail',
];

/** Sorted by e2e accuracy; model failures count as 0 there, infra failures are only counted. */
export const formatSummaryTable = (summaries: ModelSummary[]): string =>
  formatTable(
    SUMMARY_HEADER,
    summaries.map((summary) =>
      summary.skipped
        ? [
            summary.pipeline,
            summary.model,
            `skipped: ${summary.skipped}`,
            ...Array.from({ length: SUMMARY_HEADER.length - 3 }, () => ''),
          ]
        : [
            summary.pipeline,
            summary.model,
            `${summary.okRuns}/${summary.runs} (${formatPercent(summary.successRate)})`,
            formatPercent(summary.endToEndAccuracy),
            formatPercent(summary.accuracy),
            `${summary.fullMonthMatches}/${summary.personRuns}`,
            String(summary.wrongCells),
            String(summary.guessedCells),
            String(summary.nullCells),
            `${summary.undefinedKept}/${summary.undefinedFlagged}/${summary.undefinedTotal}`,
            `${summary.yearMonthMatches}/${summary.okRuns}`,
            `${summary.namesFound}/${summary.namesTotal}`,
            `${summary.definitionsCorrect}/${summary.definitionsTotal}`,
            formatSeconds(summary.pass1LatencyMs),
            formatSeconds(summary.pass2LatencyMs),
            summary.callsPerUpload === null ? '-' : summary.callsPerUpload.toFixed(2),
            formatCounts(summary.routes),
            `${formatNumber(summary.uploadInputTokens)}/${formatNumber(summary.uploadOutputTokens)}/${formatNumber(
              summary.uploadThinkingTokens,
            )}`,
            formatUsd(summary.uploadCostUsd),
            summary.uploadCostUsd === null ? '-' : `$${(summary.uploadCostUsd * 1000).toFixed(2)}`,
            String(summary.modelFailures),
            String(summary.infraFailures),
          ],
    ),
  );

/** Per-sample rows (pipeline × model × sample): sample 1 is an extreme perspective case, others typical. */
export const formatSampleTable = (summaries: ModelSummary[]): string =>
  formatTable(
    [
      'sample',
      'pipeline',
      'model',
      'success',
      'e2e accuracy',
      'full month',
      'wrong',
      '추측',
      'null',
      'p2 input',
      'fallbacks',
    ],
    summaries
      .filter((summary) => !summary.skipped)
      .map((summary) => [
        summary.sampleId ?? '(all)',
        summary.pipeline,
        summary.model,
        `${summary.okRuns}/${summary.runs}`,
        formatPercent(summary.endToEndAccuracy),
        `${summary.fullMonthMatches}/${summary.personRuns}`,
        String(summary.wrongCells),
        String(summary.guessedCells),
        String(summary.nullCells),
        formatCounts(summary.routes),
        formatCounts(summary.fallbacks),
      ]),
  );

export const formatPersonTable = (summaries: ModelSummary[], people: string[], totalDays: number): string =>
  formatTable(
    ['pipeline', 'model', ...people],
    summaries
      .filter((summary) => !summary.skipped)
      .map((summary) => [
        summary.pipeline,
        summary.model,
        ...people.map((name) => {
          const days = summary.perPerson[name] ?? [];

          return days.length === 0 ? '-' : days.map((day) => `${day}/${totalDays}`).join(' ');
        }),
      ]),
  );

/** Wrong, guessed (추측) and null cells per model/person/run, for local inspection (fictional sample names). */
export const formatCellErrors = (runs: EvalRun[]): string =>
  runs
    .filter((run) => run.status === VisionEvalStatus.OK)
    .flatMap((run) =>
      run.people.flatMap((person) => {
        const { wrongCells, guessedCells, nullDates } = person.score;

        if (wrongCells.length === 0 && guessedCells.length === 0 && nullDates.length === 0) {
          return [];
        }

        const wrong = wrongCells.map(
          (cell) => `${cell.date.slice(8)}: ${cell.expected ?? '(blank)'}→${cell.got}`,
        );
        const guessed = guessedCells.map((cell) => `${cell.date.slice(8)}: (blank)→${cell.got} 추측`);
        const nulls = nullDates.map((date) => `${date.slice(8)}: null`);

        return [
          `[${run.pipeline} ${run.model} ${run.sampleId} #${run.repeat}] ${person.score.name}: ${[...wrong, ...guessed, ...nulls].join(', ')}`,
        ];
      }),
    )
    .join('\n');
