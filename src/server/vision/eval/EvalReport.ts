import { VisionEvalStatus } from '@/domain/enums/VisionEvalStatus';
import { type ModelSummary } from '@/server/vision/eval/EvalSummary';
import { type EvalRun } from '@/server/vision/eval/EvalTypes';

/** Console tables of the eval (Spec §13, §15). */

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
  'legend absorbed',
  'month',
  'names',
  'legend',
  'p1',
  'p2',
  'calls/upload',
  'p2 input',
  'neighbour reads',
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
            String(summary.legendAbsorbed),
            `${summary.yearMonthMatches}/${summary.okRuns}`,
            `${summary.namesFound}/${summary.namesTotal}`,
            `${summary.definitionsCorrect}/${summary.definitionsTotal}`,
            formatSeconds(summary.pass1LatencyMs),
            formatSeconds(summary.pass2LatencyMs),
            summary.callsPerUpload === null ? '-' : summary.callsPerUpload.toFixed(2),
            formatCounts(summary.routes),
            `${summary.neighbourReads}/${summary.neighbourChecks}`,
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
      'legend absorbed',
      'p2 input',
      'fallbacks',
      'unverified rows',
      'neighbour reads',
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
        String(summary.legendAbsorbed),
        formatCounts(summary.routes),
        formatCounts(summary.fallbacks),
        String(summary.unverifiedRows),
        `${summary.neighbourReads}/${summary.neighbourChecks}`,
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
