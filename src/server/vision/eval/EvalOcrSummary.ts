import { VisionEvalPersonOutcome } from '@/domain/enums/VisionEvalPersonOutcome';
import { formatTable } from '@/server/vision/eval/EvalReport';
import { summarizeModel } from '@/server/vision/eval/EvalSummary';
import { type EvalPipeline, type EvalRun, type PersonRun } from '@/server/vision/eval/EvalTypes';

/** Metrics of the AI-free pipelines (Spec §20), per pipeline × model (× sample). */
export type OcrSummary = {
  pipeline: EvalPipeline;
  model: string;
  sampleId: string | null;
  persons: number;
  endToEndAccuracy: number | null;
  fullMonthMatches: number;
  wrongCells: number;
  guessedCells: number;
  /** Truth has a code, result null (확인 필요). */
  nullCells: number;
  /** Persons OCR finished alone: name read exactly and 0 unresolved cells ("AI 없이 처리 가능"). */
  finishedByOcr: number;
  /** Persons handed to AI (`ocr-then-ai`). */
  aiFallbacks: number;
  /** Target names OCR read exactly (one row). */
  namesFound: number;
  /** "Tap my row" metric: correct days / days if the user picked their row (null = not measurable). */
  tapRowAccuracy: number | null;
  /** Average per upload (= one person): whole-table OCR time + AI pass 1 + pass 2 when it fell back. */
  uploadLatencyMs: number | null;
  /** Average paid-tier USD per upload: OCR is free, a fallback pays pass 1 + its pass 2. */
  uploadCostUsd: number | null;
};

const average = (values: number[]): number | null =>
  values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;

const aiCalls = (person: PersonRun) => [
  ...(person.ocr?.aiPass1 ? [person.ocr.aiPass1] : []),
  ...person.calls,
];

/** Upload cost of one person; null when a call has no price (unknown model). */
const personCost = (person: PersonRun): number | null =>
  aiCalls(person).reduce<number | null>((sum, call) => {
    if (sum === null) {
      return null;
    }

    if (!call.ok) {
      return sum;
    }

    return call.costUsd === null ? null : sum + call.costUsd;
  }, 0);

export const summarizeOcr = (
  pipeline: EvalPipeline,
  model: string,
  runs: EvalRun[],
  sampleId: string | null = null,
): OcrSummary => {
  const base = summarizeModel(model, runs, null, pipeline, sampleId);
  const people = runs.flatMap((run) =>
    run.people.filter((person) => person.outcome !== VisionEvalPersonOutcome.INFRA_FAILURE),
  );
  const tapped = people.filter(
    (person) => person.ocr?.tapRowCorrectDays !== null && person.ocr !== undefined,
  );
  const tapDays = tapped.reduce((sum, person) => sum + person.score.totalDays, 0);
  const costs = people.map(personCost);

  return {
    pipeline,
    model,
    sampleId,
    persons: people.length,
    endToEndAccuracy: base.endToEndAccuracy,
    fullMonthMatches: base.fullMonthMatches,
    wrongCells: base.wrongCells,
    guessedCells: base.guessedCells,
    nullCells: base.nullCells,
    finishedByOcr: people.filter((person) => person.ocr?.finishedByOcr).length,
    aiFallbacks: people.filter((person) => person.ocr?.fallback).length,
    namesFound: people.filter((person) => person.ocr?.nameFound).length,
    tapRowAccuracy:
      tapDays === 0
        ? null
        : tapped.reduce((sum, person) => sum + (person.ocr?.tapRowCorrectDays ?? 0), 0) / tapDays,
    uploadLatencyMs: average(
      people.map(
        (person) =>
          (person.ocr?.ocrLatencyMs ?? 0) + aiCalls(person).reduce((sum, call) => sum + call.latencyMs, 0),
      ),
    ),
    uploadCostUsd: costs.some((cost) => cost === null) ? null : average(costs as number[]),
  };
};

const percent = (part: number, whole: number): string =>
  whole === 0 ? '-' : `${part}/${whole} (${((part / whole) * 100).toFixed(0)}%)`;

const formatRatio = (value: number | null): string => (value === null ? '-' : `${(value * 100).toFixed(1)}%`);

/** OCR / hybrid table: accuracy, the AI-free share, AI fallbacks, name reading, latency and cost. */
export const formatOcrTable = (summaries: OcrSummary[]): string =>
  formatTable(
    [
      'sample',
      'pipeline',
      'model',
      'e2e accuracy',
      'full month',
      'wrong',
      '추측',
      '확인 필요',
      'AI 없이 처리',
      'AI fallback',
      'names exact',
      'tap-row acc',
      'latency/upload',
      '$/upload',
      '$/1k uploads',
    ],
    summaries.map((summary) => [
      summary.sampleId ?? '(all)',
      summary.pipeline,
      summary.model,
      formatRatio(summary.endToEndAccuracy),
      `${summary.fullMonthMatches}/${summary.persons}`,
      String(summary.wrongCells),
      String(summary.guessedCells),
      String(summary.nullCells),
      percent(summary.finishedByOcr, summary.persons),
      percent(summary.aiFallbacks, summary.persons),
      percent(summary.namesFound, summary.persons),
      formatRatio(summary.tapRowAccuracy),
      summary.uploadLatencyMs === null ? '-' : `${(summary.uploadLatencyMs / 1000).toFixed(1)}s`,
      summary.uploadCostUsd === null ? '-' : `$${summary.uploadCostUsd.toFixed(5)}`,
      summary.uploadCostUsd === null ? '-' : `$${(summary.uploadCostUsd * 1000).toFixed(3)}`,
    ]),
  );
