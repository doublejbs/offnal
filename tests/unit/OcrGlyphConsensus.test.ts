import { describe, expect, it } from 'vitest';

import { OcrCellInk } from '@/domain/enums/OcrCellInk';
import { OcrCodeSource } from '@/domain/enums/OcrCodeSource';
import { normalizeExtraction } from '@/domain/ScheduleValidator';
import { collapseRepeats, resolveByConsensus } from '@/server/vision/ocr/GlyphConsensus';
import { type GlyphDescriptor } from '@/server/vision/ocr/GlyphDescriptor';
import {
  buildOcrExtraction,
  countBlankCells,
  countReviewCells,
  countUnresolved,
  findOcrRow,
} from '@/server/vision/ocr/OcrPersonExtraction';
import { type OcrCell, type OcrTable } from '@/server/vision/ocr/OcrTableTypes';

/** Descriptor whose densities are `value` everywhere (distinct values = distinct shapes). */
const shape = (value: number, aspect = 1): GlyphDescriptor => ({
  densities: new Float32Array(256).fill(value),
  aspect,
});

describe('glyph consensus', () => {
  it('lets an unsure cell take the clearly closest code, unless OCR read another code', () => {
    const cells = [
      { descriptor: shape(0.2), code: 'D', token: 'D' },
      { descriptor: shape(0.21), code: 'D', token: 'D' },
      { descriptor: shape(0.7), code: 'E', token: 'E' },
      { descriptor: shape(0.205), code: null, token: '' },
      { descriptor: shape(0.205), code: null, token: 'E' },
    ];
    const { decisions } = resolveByConsensus(cells, ['D', 'E']);

    expect(decisions[3]).toEqual({ code: 'D', source: OcrCodeSource.GLYPH });
    expect(decisions[4]).toEqual({ code: null, source: OcrCodeSource.NONE });
    expect(decisions[0]).toEqual({ code: 'D', source: OcrCodeSource.OCR });
  });

  it('withdraws a confident OCR code whose glyph clearly looks like another code', () => {
    const cells = [
      { descriptor: shape(0.2), code: 'D', token: 'D' },
      { descriptor: shape(0.21), code: 'D', token: 'D' },
      { descriptor: shape(0.7), code: 'E', token: 'E' },
      { descriptor: shape(0.2), code: 'E', token: 'E' },
    ];

    expect(resolveByConsensus(cells, ['D', 'E']).decisions[3]!.code).toBeNull();
  });

  it('discovers a code read consistently but never confidently (W)', () => {
    const cells = [
      { descriptor: shape(0.2), code: 'D', token: 'D' },
      { descriptor: shape(0.6, 1.4), code: null, token: 'W' },
      { descriptor: shape(0.61, 1.4), code: null, token: 'WW' },
    ];
    const result = resolveByConsensus(cells, ['D']);

    expect(result.dictionary).toEqual(['D', 'W']);
    expect(result.decisions.map((decision) => decision.code)).toEqual(['D', 'W', 'W']);
    expect(collapseRepeats('OFF')).toBe('OFF');
  });
});

describe('OCR person extraction', () => {
  const cell = (day: number, ink: OcrCellInk, code: string | null, token: string | null): OcrCell => ({
    day,
    ink,
    rect: { left: 0, top: 0, right: 1, bottom: 1 },
    token,
    confidence: null,
    code,
    source: OcrCodeSource.OCR,
    glyphPng: null,
  });
  const table: OcrTable = {
    yearMonth: '2026-02',
    dayCount: 28,
    dictionary: ['D'],
    definitions: [],
    rows: [
      {
        index: 0,
        rect: { left: 0, top: 0, right: 1, bottom: 1 },
        name: '가상하나',
        nameConfidence: 90,
        cells: [
          cell(1, OcrCellInk.TEXT, 'D', ''),
          cell(2, OcrCellInk.DASH, null, null),
          cell(3, OcrCellInk.TEXT, null, 'OF'),
          cell(4, OcrCellInk.AMBIGUOUS, null, null),
          ...Array.from({ length: 24 }, (_value, index) => cell(index + 5, OcrCellInk.BLANK, null, null)),
        ],
      },
      {
        index: 1,
        rect: { left: 0, top: 0, right: 1, bottom: 1 },
        name: '가상둘',
        nameConfidence: 90,
        cells: [],
      },
      {
        index: 2,
        rect: { left: 0, top: 0, right: 1, bottom: 1 },
        name: '가상둘',
        nameConfidence: 90,
        cells: [],
      },
    ],
  };

  it('maps decided, dash, unresolved and faint cells for normalizeExtraction', () => {
    const row = findOcrRow(table, '가상 하나')!;
    const extraction = buildOcrExtraction({ ...table, yearMonth: '2026-04' }, row, '2026-02');
    const schedule = normalizeExtraction(extraction, '2026-02');

    expect(extraction.yearMonth).toBe('2026-02');
    expect(schedule.entries.slice(0, 4).map((entry) => entry.code)).toEqual(['D', null, null, null]);
    // Fallback count: unread text + faint ink (+ days the grid misses); blank and dash are not counted.
    expect(countUnresolved(row, '2026-02')).toBe(2);
    expect(countUnresolved(row, '2026-03')).toBe(2 + 3);
    // AI-free count: every day left to confirm, blank and dash included (same rule as for AI results).
    expect(countBlankCells(row, '2026-02')).toBe(25);
    expect(countReviewCells(schedule)).toBe(27);
    expect(findOcrRow(table, '가상둘')).toBeNull();
  });
});
