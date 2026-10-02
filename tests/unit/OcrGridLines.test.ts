import { describe, expect, it } from 'vitest';

import { detectGrid } from '@/server/vision/ocr/GridDetector';
import { toGrayChroma } from '@/server/vision/ocr/GrayRaster';
import {
  findLinePeaks,
  profileHorizontalRuns,
  profileVerticalRuns,
  regularizeLines,
  sumWindow,
} from '@/server/vision/ocr/LineProfile';
import { detectTableQuad } from '@/server/vision/ocr/TableQuadDetector';
import { type RawImage } from '@/server/vision/VisionGeometry';

const COLUMNS = 32;
const ROWS = 12;
const CELL_W = 30;
const CELL_H = 26;
const OFFSET = 60;

/** White page with a dark grid (one thick separator row line) and a blue weekend column band. */
const buildSheet = (): RawImage => {
  const width = COLUMNS * CELL_W + OFFSET * 2;
  const height = ROWS * CELL_H + OFFSET * 2;
  const data = Buffer.alloc(width * height * 3, 255);
  const paint = (x: number, y: number, rgb: [number, number, number]) => {
    data.set(rgb, (y * width + x) * 3);
  };

  for (let y = OFFSET; y <= OFFSET + ROWS * CELL_H; y += 1) {
    for (let x = OFFSET; x <= OFFSET + COLUMNS * CELL_W; x += 1) {
      const gx = x - OFFSET;
      const gy = y - OFFSET;
      const thick = Math.floor(gy / CELL_H) === 6 && gy % CELL_H < 4;

      if (gx % CELL_W < 2 || gy % CELL_H < 2 || thick) {
        paint(x, y, [30, 30, 30]);
      } else if (Math.floor(gx / CELL_W) === 5) {
        paint(x, y, [120, 150, 230]);
      }
    }
  }

  return { data, width, height };
};

describe('line profiles and peaks', () => {
  it('counts only long runs and finds one peak per line, merging close stretches', () => {
    const mask = { width: 10, height: 4, data: new Uint8Array(40) };

    mask.data.fill(1, 0, 10);
    mask.data.fill(1, 22, 24);

    const profile = profileHorizontalRuns(
      mask,
      { left: 0, top: 0, right: 10, bottom: 4 },
      { minRun: 5, maxGap: 0 },
    );

    expect(Array.from(profile)).toEqual([10, 0, 0, 0]);
    expect(
      Array.from(
        profileVerticalRuns(mask, { left: 0, top: 0, right: 10, bottom: 4 }, { minRun: 2, maxGap: 0 }),
      ),
    ).toEqual(Array.from({ length: 10 }, () => 0));
    expect(findLinePeaks([0, 9, 9, 0, 0, 0, 8, 0, 0, 1, 7, 0], 5, 2).map((peak) => peak.position)).toEqual([
      1.5, 6, 10,
    ]);
    expect(findLinePeaks([0, 9, 0, 8, 0], 5, 2)).toHaveLength(1);
    expect(Array.from(sumWindow([0, 3, 0, 0], 3))).toEqual([3, 3, 3, 0]);
  });

  it('re-inserts a missed line and drops a spurious one in evenly spaced runs', () => {
    // 103 is a weak spurious line next to 100; 80 is missing.
    const lines = [0, 50, 60, 70, 90, 100, 103, 110].map((position) => ({
      position,
      strength: position === 103 ? 2 : 10,
    }));
    const regular = regularizeLines(lines, 1).map((line) => line.position);

    expect(regular).toEqual([0, 50, 60, 70, 80, 90, 100, 110]);
  });
});

describe('table detection on a synthetic sheet', () => {
  it('finds the border quad and every row/column line despite the colored band and thick line', () => {
    const sheet = buildSheet();
    const detection = detectTableQuad(sheet);

    expect(detection).not.toBeNull();

    const [topLeft, , bottomRight] = detection!.quad;

    expect(topLeft.x).toBeCloseTo(OFFSET, -1);
    expect(bottomRight.y).toBeCloseTo(OFFSET + ROWS * CELL_H, -1);

    const grid = detectGrid({
      raw: sheet,
      pixels: toGrayChroma(sheet),
      table: { left: OFFSET, top: OFFSET, right: OFFSET + COLUMNS * CELL_W, bottom: OFFSET + ROWS * CELL_H },
    });

    expect(grid?.columnLines).toHaveLength(COLUMNS + 1);
    expect(grid?.rowLines).toHaveLength(ROWS + 1);
  });
});
