import { describe, expect, it } from 'vitest';

import { computePngLayout, PNG_SCALE, PNG_WIDTH } from '@/client/PngLayout';

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

  it('grows with the number of weeks and legend rows', () => {
    const fiveWeeks = computePngLayout('2026-10', 5);
    const sixWeeks = computePngLayout('2026-08', 5);
    const longLegend = computePngLayout('2026-10', 9);

    expect(sixWeeks.height).toBeGreaterThan(fiveWeeks.height);
    expect(longLegend.height).toBeGreaterThan(fiveWeeks.height);
  });
});
