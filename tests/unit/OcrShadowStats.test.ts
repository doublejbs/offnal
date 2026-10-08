import { describe, expect, it } from 'vitest';

import { OcrShadowStatus } from '@/domain/enums/OcrShadowStatus';
import {
  formatShadowSummary,
  percentile,
  summarizeShadowRuns,
  type ShadowRunStats,
} from '@/server/vision/ocr/OcrShadowStats';

const run = (overrides: Partial<ShadowRunStats>): ShadowRunStats => ({
  status: OcrShadowStatus.OK,
  wouldFallback: false,
  reviewCells: 0,
  disagreeCells: 0,
  ocrMs: 1000,
  rssMb: 300,
  coldStart: false,
  ...overrides,
});

describe('shadow OCR report', () => {
  it('aggregates statuses, AI-free share, fallback share, disagreements and latency percentiles', () => {
    const summary = summarizeShadowRuns([
      run({ ocrMs: 1000, rssMb: 300, coldStart: true }),
      run({ ocrMs: 2000, rssMb: 310, reviewCells: 2 }),
      run({ ocrMs: 3000, rssMb: 320, wouldFallback: true, disagreeCells: 2, reviewCells: 3 }),
      run({
        status: OcrShadowStatus.TABLE_FAILED,
        wouldFallback: true,
        reviewCells: null,
        disagreeCells: null,
        ocrMs: 4000,
        rssMb: 330,
      }),
      run({
        status: OcrShadowStatus.TIMEOUT,
        wouldFallback: true,
        reviewCells: null,
        disagreeCells: null,
        ocrMs: 60000,
        rssMb: 340,
        coldStart: true,
      }),
    ]);

    expect(summary).toEqual({
      total: 5,
      byStatus: {
        ok: 3,
        table_failed: 1,
        row_not_found: 0,
        timeout: 1,
        error: 0,
        skipped_busy: 0,
        skipped_budget: 0,
      },
      skipped: 0,
      aiFreeRate: 0.2,
      fallbackRate: 0.6,
      disagreeCells: 2,
      ocrMs: { p50: 3000, p95: 60000 },
      rssMb: { p50: 320, p95: 340 },
      coldStartRate: 0.4,
    });

    const text = formatShadowSummary(summary, 7);

    expect(text).toContain('최근 7일');
    expect(text).toContain('20.0%');
  });

  it('counts skipped runs but leaves them out of every rate and percentile', () => {
    const skippedRun = { wouldFallback: true, reviewCells: null, disagreeCells: null, ocrMs: 0, rssMb: 900 };
    const summary = summarizeShadowRuns([
      run({ ocrMs: 2000, rssMb: 300 }),
      run({ ocrMs: 4000, rssMb: 320, wouldFallback: true, coldStart: true }),
      run({ status: OcrShadowStatus.SKIPPED_BUSY, ...skippedRun }),
      run({ status: OcrShadowStatus.SKIPPED_BUDGET, ...skippedRun }),
    ]);

    expect(summary).toMatchObject({
      total: 4,
      skipped: 2,
      byStatus: expect.objectContaining({ skipped_busy: 1, skipped_budget: 1 }),
      aiFreeRate: 0.5,
      fallbackRate: 0.5,
      ocrMs: { p50: 2000, p95: 4000 },
      rssMb: { p50: 300, p95: 320 },
      coldStartRate: 0.5,
    });
    expect(formatShadowSummary(summary, 7)).toContain(
      '건너뜀(동시 실행·시간 예산 부족, 아래 비율에서 제외): 2건',
    );
  });

  it('handles an empty period and nearest-rank percentiles', () => {
    expect(summarizeShadowRuns([])).toMatchObject({
      total: 0,
      aiFreeRate: null,
      ocrMs: { p50: null, p95: null },
    });
    expect(percentile([5, 1, 3, 2, 4], 0.5)).toBe(3);
    expect(percentile([1, 2], 0.95)).toBe(2);
    expect(percentile([], 0.5)).toBeNull();
  });
});
