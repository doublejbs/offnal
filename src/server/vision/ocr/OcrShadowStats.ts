import { OcrShadowStatus } from '@/domain/enums/OcrShadowStatus';

/** The `ocr_shadow_runs` columns the report reads. */
export type ShadowRunStats = {
  status: OcrShadowStatus;
  wouldFallback: boolean;
  reviewCells: number | null;
  disagreeCells: number | null;
  ocrMs: number;
  rssMb: number;
  coldStart: boolean;
};

type Percentiles = { p50: number | null; p95: number | null };

export type ShadowSummary = {
  total: number;
  byStatus: Record<OcrShadowStatus, number>;
  /** ok, no fallback and 0 review cells: the share stage 2 would finish without AI. */
  aiFreeRate: number | null;
  /** Runs that would hand the person to AI (1 unresolved cell, or table/row failure). */
  fallbackRate: number | null;
  /** Days where both read a code and the codes differ (manual check candidates). */
  disagreeCells: number;
  ocrMs: Percentiles;
  rssMb: Percentiles;
  coldStartRate: number | null;
};

/** Nearest-rank percentile (`share` 0–1); null for no values. */
export const percentile = (values: number[], share: number): number | null => {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.max(1, Math.ceil(share * sorted.length));

  return sorted[rank - 1]!;
};

const toRate = (count: number, total: number): number | null => (total === 0 ? null : count / total);

const toPercentiles = (values: number[]): Percentiles => ({
  p50: percentile(values, 0.5),
  p95: percentile(values, 0.95),
});

export const summarizeShadowRuns = (runs: ShadowRunStats[]): ShadowSummary => {
  const byStatus = Object.fromEntries(Object.values(OcrShadowStatus).map((status) => [status, 0])) as Record<
    OcrShadowStatus,
    number
  >;

  for (const run of runs) {
    byStatus[run.status] += 1;
  }

  const aiFree = runs.filter(
    (run) => run.status === OcrShadowStatus.OK && !run.wouldFallback && run.reviewCells === 0,
  ).length;

  return {
    total: runs.length,
    byStatus,
    aiFreeRate: toRate(aiFree, runs.length),
    fallbackRate: toRate(runs.filter((run) => run.wouldFallback).length, runs.length),
    disagreeCells: runs.reduce((sum, run) => sum + (run.disagreeCells ?? 0), 0),
    ocrMs: toPercentiles(runs.map((run) => run.ocrMs)),
    rssMb: toPercentiles(runs.map((run) => run.rssMb)),
    coldStartRate: toRate(runs.filter((run) => run.coldStart).length, runs.length),
  };
};

const formatRate = (rate: number | null): string => (rate === null ? '-' : `${(rate * 100).toFixed(1)}%`);

const formatValue = (value: number | null, unit: string): string =>
  value === null ? '-' : `${value}${unit}`;

/** Plain-text report (numbers only). */
export const formatShadowSummary = (summary: ShadowSummary, days: number): string => {
  const statuses = Object.entries(summary.byStatus)
    .map(([status, count]) => `${status} ${count}`)
    .join(', ');

  return [
    `[ocr:shadow-report] 최근 ${days}일 그림자 실행 ${summary.total}건`,
    `- 상태별: ${statuses}`,
    `- AI 없이 처리 가능(ok·대체 없음·확인 필요 0칸): ${formatRate(summary.aiFreeRate)}`,
    `- AI 대체(미해결 1칸 이상 또는 표·행 실패): ${formatRate(summary.fallbackRate)}`,
    `- AI와 다른 값을 낸 칸 합계: ${summary.disagreeCells}`,
    `- OCR 시간 p50 ${formatValue(summary.ocrMs.p50, 'ms')}, p95 ${formatValue(summary.ocrMs.p95, 'ms')}`,
    `- 메모리(RSS) p50 ${formatValue(summary.rssMb.p50, 'MB')}, p95 ${formatValue(summary.rssMb.p95, 'MB')}`,
    `- 콜드 스타트 비율: ${formatRate(summary.coldStartRate)}`,
  ].join('\n');
};
