import { describe, expect, it } from 'vitest';

import { solveHomography } from '@/server/vision/Homography';
import { warpRaw } from '@/server/vision/PerspectiveWarp';
import { isPlausibleRefinement, refineQuad } from '@/server/vision/QuadRefiner';
import { type PixelPoint, type Quad, type RawImage } from '@/server/vision/VisionGeometry';

const COLUMNS = 31;
const ROWS = 17;
const CELL = 40;

/** White grid with dark 3px lines, like a printed roster. */
const buildGrid = (): RawImage => {
  const width = COLUMNS * CELL + 3;
  const height = ROWS * CELL + 3;
  const data = Buffer.alloc(width * height * 3, 255);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x % CELL < 3 || y % CELL < 3) {
        data.fill(30, (y * width + x) * 3, (y * width + x) * 3 + 3);
      }
    }
  }

  return { data, width, height };
};

const TRUE_QUAD: Quad = [
  { x: 245, y: 300 },
  { x: 1375, y: 245 },
  { x: 1480, y: 800 },
  { x: 215, y: 835 },
];

const project = (grid: RawImage): RawImage =>
  warpRaw(
    grid,
    1536,
    1152,
    solveHomography(TRUE_QUAD, [
      { x: 0, y: 0 },
      { x: grid.width, y: 0 },
      { x: grid.width, y: grid.height },
      { x: 0, y: grid.height },
    ])!,
  );

const angleDeg = (from: PixelPoint, to: PixelPoint) =>
  (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;

const edgeAngles = (quad: Quad) => [
  angleDeg(quad[0], quad[1]),
  angleDeg(quad[1], quad[2]),
  angleDeg(quad[3], quad[2]),
  angleDeg(quad[0], quad[3]),
];

describe('refineQuad', () => {
  it('turns a near-rectangle model quad into the tilted grid of the photo', () => {
    const photo = project(buildGrid());
    // What a small model returns: roughly the right area, but axis-aligned.
    const rough: Quad = [
      { x: 240, y: 285 },
      { x: 1400, y: 285 },
      { x: 1400, y: 820 },
      { x: 240, y: 820 },
    ];
    const refined = refineQuad(photo, rough);
    const expected = edgeAngles(TRUE_QUAD);

    edgeAngles(refined).forEach((angle, index) => {
      expect(Math.abs(angle - expected[index]!)).toBeLessThan(0.6);
    });
  });

  it('keeps the quad on a blank image', () => {
    const blank: RawImage = { data: Buffer.alloc(800 * 600 * 3, 255), width: 800, height: 600 };
    const quad: Quad = [
      { x: 100, y: 100 },
      { x: 700, y: 100 },
      { x: 700, y: 500 },
      { x: 100, y: 500 },
    ];

    expect(refineQuad(blank, quad)).toEqual(quad);
  });

  it('rejects refinements that move a corner beyond MAX_CORNER_SHIFT_SHARE or lose an intersection', () => {
    const quad: Quad = [
      { x: 0, y: 0 },
      { x: 300, y: 0 },
      { x: 300, y: 400 },
      { x: 0, y: 400 },
    ];
    // Diagonal 500 → max shift 75 px.
    const shifted = (dx: number): Quad => [{ x: dx, y: 0 }, quad[1], quad[2], quad[3]];

    expect(isPlausibleRefinement(quad, shifted(70))).toBe(true);
    expect(isPlausibleRefinement(quad, shifted(80))).toBe(false);
    expect(isPlausibleRefinement(quad, [null, quad[1], quad[2], quad[3]])).toBe(false);
  });
});
