import { describe, expect, it } from 'vitest';

import { collectPngTexts, computePngLayout, PNG_SCALE, PNG_WEIGHTS, PNG_WIDTH } from '@/client/PngLayout';

describe('PngLayout', () => {
  it('is 1080px wide and rendered at 2x', () => {
    const layout = computePngLayout('2026-10', 5);

    expect(PNG_WIDTH).toBe(1080);
    expect(PNG_SCALE).toBe(2);
    expect(layout.width).toBe(1080);
  });

  it('places one cell per date in the weekday column', () => {
    const layout = computePngLayout('2026-10', 5);
    const first = layout.cells[0];
    const eighth = layout.cells[7];

    expect(layout.cells).toHaveLength(31);
    expect(first?.date).toBe('2026-10-01');
    // Thursday = column 4
    expect(first?.x).toBe(layout.gridLeft + 4 * layout.cellWidth);
    expect(eighth?.x).toBe(first?.x);
    expect(eighth?.y).toBe((first?.y ?? 0) + layout.cellHeight);
  });

  it('keeps every cell inside the canvas', () => {
    for (const yearMonth of ['2026-08', '2026-02', '2026-10']) {
      const layout = computePngLayout(yearMonth, 8);

      for (const cell of layout.cells) {
        expect(cell.x).toBeGreaterThanOrEqual(0);
        expect(cell.x + layout.cellWidth).toBeLessThanOrEqual(layout.width);
        expect(cell.y + layout.cellHeight).toBeLessThanOrEqual(layout.legendTop);
      }

      expect(layout.footerY).toBeLessThan(layout.height);
    }
  });

  it('collects every drawn string per weight so the font subsets can be preloaded', () => {
    const legend = [
      { code: 'D', label: '데이', startTime: '07:00', endTime: '16:00', endsNextDay: false, isOff: false },
      { code: '연차', label: '연차휴가', startTime: null, endTime: null, endsNextDay: null, isOff: true },
    ];
    const texts = collectPngTexts(
      {
        displayName: '남궁하늘빛나래',
        yearMonth: '2026-10',
        definitions: legend,
        entries: [{ date: '2026-10-01', code: '연차', reviewReasons: [], confirmed: true }],
        generatedAt: '2026-09-29T09:30:00.000Z',
        updatedAt: '2026-09-29T09:30:00.000Z',
      },
      legend,
    );

    expect(PNG_WEIGHTS).toEqual([400, 500, 600]);
    expect(texts[600]).toContain('오프날');
    expect(texts[600]).toContain('남궁하늘빛나래 · 2026년 10월');
    expect(texts[600]).toContain('연차');
    expect(texts[500]).toContain('일월화수목금토');
    expect(texts[400]).toContain('데이 · 07:00–16:00');
    expect(texts[400]).toContain('연차휴가');
    expect(texts[400]).toContain('생성 2026.09.29 18:30');
    expect(texts[400]).not.toContain('휴무 · 휴무');
  });

  it('grows with the number of weeks and legend rows', () => {
    const fiveWeeks = computePngLayout('2026-10', 5);
    const sixWeeks = computePngLayout('2026-08', 5);
    const longLegend = computePngLayout('2026-10', 9);

    expect(sixWeeks.height).toBeGreaterThan(fiveWeeks.height);
    expect(longLegend.height).toBeGreaterThan(fiveWeeks.height);
  });
});
