import { VisionEvalFailureKind } from '@/domain/enums/VisionEvalFailureKind';
import { VisionEvalPersonOutcome } from '@/domain/enums/VisionEvalPersonOutcome';
import { VisionEvalStatus } from '@/domain/enums/VisionEvalStatus';
import { type CallRecord, type EvalRun } from '@/server/vision/eval/EvalRunner';

export type ModelSummary = {
  model: string;
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
  pass2LatencyMs: number | null;
  /** Average tokens of one upload = pass 1 + one pass 2. */
  uploadInputTokens: number | null;
  uploadOutputTokens: number | null;
  uploadThinkingTokens: number | null;
  /** Estimated paid-tier USD of one upload = pass 1 + one pass 2. */
  uploadCostUsd: number | null;
  /** name → correct days per OK run (in run order). */
  perPerson: Record<string, number[]>;
};

const average = (values: number[]): number | null =>
  values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;

const sumOrNull = (a: number | null, b: number | null): number | null =>
  a === null || b === null ? null : a + b;

const okCalls = (calls: (CallRecord | null)[]): CallRecord[] =>
  calls.filter((call): call is CallRecord => call !== null && call.ok);

export const summarizeModel = (model: string, runs: EvalRun[], skipped: string | null): ModelSummary => {
  const ok = runs.filter((run) => run.status === VisionEvalStatus.OK);
  const people = ok.flatMap((run) => run.people.map((person) => person.score));
  const tables = ok.flatMap((run) => (run.table ? [run.table] : []));
  const pass1 = okCalls(ok.map((run) => run.tableCall));
  const pass2 = okCalls(ok.flatMap((run) => run.people.map((person) => person.call)));
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

  for (const person of people) {
    perPerson[person.name] = [...(perPerson[person.name] ?? []), person.correctDays];
  }

  return {
    model,
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

const SUMMARY_HEADER = [
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
            summary.model,
            `skipped: ${summary.skipped}`,
            ...Array.from({ length: SUMMARY_HEADER.length - 2 }, () => ''),
          ]
        : [
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

export const formatPersonTable = (summaries: ModelSummary[], people: string[], totalDays: number): string =>
  formatTable(
    ['model', ...people],
    summaries
      .filter((summary) => !summary.skipped)
      .map((summary) => [
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
          `[${run.model} #${run.repeat}] ${person.score.name}: ${[...wrong, ...guessed, ...nulls].join(', ')}`,
        ];
      }),
    )
    .join('\n');
