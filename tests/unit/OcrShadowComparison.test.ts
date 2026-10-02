import { describe, expect, it } from 'vitest';

import { OcrShadowStatus } from '@/domain/enums/OcrShadowStatus';
import { OcrTableFailure } from '@/domain/enums/OcrTableFailure';
import { type OcrTableResult } from '@/server/vision/ocr/OcrTableTypes';
import { compareSchedules, measureOcrTable } from '@/server/vision/ocr/OcrShadowComparison';
import {
  buildAiSchedule,
  buildOcrRow,
  buildOcrTable,
  MIXED_AI_CODES,
  MIXED_OCR_SPECS,
  OTHER_NAME,
  repeatCode,
  SHADOW_MONTH,
  SHADOW_NAME,
} from './support/OcrShadowFixture';

const GEOMETRY = { quad: null, warped: null, grid: null, headerRow: null };

const okResult = (rows: ReturnType<typeof buildOcrRow>[]): OcrTableResult => ({
  ok: true,
  table: buildOcrTable(rows),
  geometry: GEOMETRY,
  latencyMs: 10,
});

describe('shadow OCR comparison', () => {
  it('counts agreeing, disagreeing and one-sided null days against the AI result', () => {
    const ai = buildAiSchedule(MIXED_AI_CODES);
    const result = okResult([
      buildOcrRow(0, OTHER_NAME, repeatCode('E', 28)),
      buildOcrRow(1, SHADOW_NAME, MIXED_OCR_SPECS),
    ]);

    expect(measureOcrTable(result, SHADOW_NAME, SHADOW_MONTH, ai)).toEqual({
      status: OcrShadowStatus.OK,
      counts: { dayCount: 28, agreeCells: 23, disagreeCells: 1, ocrNullCells: 3, aiNullCells: 1 },
      // Day 3 (text without a dictionary code) + days 27–28 the grid does not reach.
      unresolvedCells: 3,
      reviewCells: 3,
      wouldFallback: true,
    });
  });

  it('does not fall back when OCR settles every day and matches AI', () => {
    const codes = ['E', ...repeatCode('D', 27)];
    const result = okResult([buildOcrRow(0, SHADOW_NAME, codes)]);

    expect(measureOcrTable(result, ' 김 하루 ', SHADOW_MONTH, buildAiSchedule(codes))).toMatchObject({
      status: OcrShadowStatus.OK,
      counts: { dayCount: 28, agreeCells: 28, disagreeCells: 0, ocrNullCells: 0, aiNullCells: 0 },
      unresolvedCells: 0,
      reviewCells: 0,
      wouldFallback: false,
    });
  });

  it('counts a blank day as review but not unresolved, and days null on both sides in no bucket', () => {
    const codes: (string | null)[] = [null, ...repeatCode('D', 27)];
    const result = okResult([buildOcrRow(0, SHADOW_NAME, codes)]);

    expect(measureOcrTable(result, SHADOW_NAME, SHADOW_MONTH, buildAiSchedule(codes))).toMatchObject({
      counts: { dayCount: 28, agreeCells: 27, disagreeCells: 0, ocrNullCells: 0, aiNullCells: 0 },
      unresolvedCells: 0,
      reviewCells: 1,
      wouldFallback: false,
    });
  });

  it('reports a missing or duplicated name and an unreadable table as fallbacks without counts', () => {
    const ai = buildAiSchedule(MIXED_AI_CODES);
    const duplicated = okResult([
      buildOcrRow(0, SHADOW_NAME, MIXED_OCR_SPECS),
      buildOcrRow(1, SHADOW_NAME, MIXED_OCR_SPECS),
    ]);
    const failed: OcrTableResult = {
      ok: false,
      failure: OcrTableFailure.NO_GRID,
      geometry: GEOMETRY,
      latencyMs: 5,
    };
    const empty = { counts: null, unresolvedCells: null, reviewCells: null, wouldFallback: true };

    expect(measureOcrTable(okResult([]), SHADOW_NAME, SHADOW_MONTH, ai)).toEqual({
      status: OcrShadowStatus.ROW_NOT_FOUND,
      ...empty,
    });
    expect(measureOcrTable(duplicated, SHADOW_NAME, SHADOW_MONTH, ai).status).toBe(
      OcrShadowStatus.ROW_NOT_FOUND,
    );
    expect(measureOcrTable(failed, SHADOW_NAME, SHADOW_MONTH, ai)).toEqual({
      status: OcrShadowStatus.TABLE_FAILED,
      ...empty,
    });
  });

  it('compares two schedules day by day', () => {
    expect(compareSchedules(buildAiSchedule(['D', 'E', null]), buildAiSchedule(['D', null, 'N']))).toEqual({
      dayCount: 28,
      agreeCells: 1,
      disagreeCells: 0,
      ocrNullCells: 1,
      aiNullCells: 1,
    });
  });
});
