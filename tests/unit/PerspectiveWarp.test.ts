import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { ImageMimeType } from '@/domain/enums/ImageMimeType';
import { type GridCorners } from '@/domain/types/GridCorners';
import {
  applyHomography,
  isValidQuad,
  type PixelPoint,
  planWarp,
  type Quad,
  type RawImage,
  solveHomography,
  toPixelQuad,
  WARP_MARGINS,
  warpRaw,
  warpToGrid,
} from '@/server/vision/PerspectiveWarp';

const SQUARE: Quad = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

const SKEWED: Quad = [
  { x: 245, y: 300 },
  { x: 1375, y: 245 },
  { x: 1470, y: 800 },
  { x: 215, y: 830 },
];

const expectPoint = (actual: PixelPoint, expected: PixelPoint, precision = 6) => {
  expect(actual.x).toBeCloseTo(expected.x, precision);
  expect(actual.y).toBeCloseTo(expected.y, precision);
};

describe('solveHomography', () => {
  it('maps each source corner onto its target corner', () => {
    const homography = solveHomography(SQUARE, SKEWED);

    expect(homography).not.toBeNull();
    SQUARE.forEach((point, index) => {
      expectPoint(applyHomography(homography!, point), SKEWED[index]!);
    });
  });

  it('round-trips interior points through the inverse homography', () => {
    const forward = solveHomography(SQUARE, SKEWED)!;
    const inverse = solveHomography(SKEWED, SQUARE)!;

    for (const point of [
      { x: 0.5, y: 0.5 },
      { x: 0.1, y: 0.9 },
      { x: 0.73, y: 0.21 },
      { x: -0.18, y: 0.4 },
    ]) {
      expectPoint(applyHomography(inverse, applyHomography(forward, point)), point, 9);
    }
  });

  it('returns the identity-like affine map for a scaled rectangle', () => {
    const target: Quad = [
      { x: 10, y: 20 },
      { x: 210, y: 20 },
      { x: 210, y: 120 },
      { x: 10, y: 120 },
    ];
    const homography = solveHomography(SQUARE, target)!;

    expectPoint(applyHomography(homography, { x: 0.25, y: 0.5 }), { x: 60, y: 70 });
    // No projective terms for an axis-aligned rectangle.
    expect(homography[6]).toBeCloseTo(0, 12);
    expect(homography[7]).toBeCloseTo(0, 12);
  });

  it('returns null for degenerate correspondences', () => {
    const collapsed: Quad = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: 3 },
    ];

    expect(solveHomography(SQUARE, collapsed)).toBeNull();
  });
});

describe('isValidQuad', () => {
  const width = 1536;
  const height = 1152;

  it('accepts a clockwise convex quad covering enough of the image', () => {
    expect(isValidQuad(SKEWED, width, height)).toBe(true);
  });

  it('rejects self-intersecting, counter-clockwise, tiny, non-finite and out-of-image quads', () => {
    const [topLeft, topRight, bottomRight, bottomLeft] = SKEWED;

    expect(isValidQuad([topLeft!, bottomRight!, topRight!, bottomLeft!], width, height)).toBe(false);
    expect(isValidQuad([topLeft!, bottomLeft!, bottomRight!, topRight!], width, height)).toBe(false);
    expect(
      isValidQuad(
        [
          { x: 100, y: 100 },
          { x: 300, y: 100 },
          { x: 300, y: 300 },
          { x: 100, y: 300 },
        ],
        width,
        height,
      ),
    ).toBe(false);
    expect(isValidQuad([topLeft!, topRight!, { x: Number.NaN, y: 800 }, bottomLeft!], width, height)).toBe(
      false,
    );
    expect(isValidQuad([topLeft!, topRight!, { x: 5000, y: 800 }, bottomLeft!], width, height)).toBe(false);
  });

  it('rejects a concave quad', () => {
    const concave: Quad = [
      { x: 100, y: 100 },
      { x: 1400, y: 100 },
      { x: 700, y: 400 },
      { x: 100, y: 1000 },
    ];

    expect(isValidQuad(concave, width, height)).toBe(false);
  });
});

describe('planWarp', () => {
  it('sizes the output from the mean edge lengths plus margins and places the day grid', () => {
    const quad: Quad = [
      { x: 100, y: 100 },
      { x: 1100, y: 100 },
      { x: 1100, y: 600 },
      { x: 100, y: 600 },
    ];
    const plan = planWarp(quad, 2576);

    expect(plan).not.toBeNull();
    expect(plan!.width).toBe(Math.round(1000 * (1 + WARP_MARGINS.left + WARP_MARGINS.right)));
    expect(plan!.height).toBe(Math.round(500 * (1 + WARP_MARGINS.top + WARP_MARGINS.bottom)));
    expect(plan!.dayGrid.left).toBeCloseTo(1000 * WARP_MARGINS.left, 0);
    expect(plan!.dayGrid.top).toBeCloseTo(500 * WARP_MARGINS.top, 0);
    expect(plan!.dayGrid.right - plan!.dayGrid.left).toBeCloseTo(1000, 0);
  });

  it('keeps the long edge within the limit', () => {
    const quad: Quad = [
      { x: 0, y: 0 },
      { x: 4000, y: 0 },
      { x: 4000, y: 2000 },
      { x: 0, y: 2000 },
    ];
    const plan = planWarp(quad, 2576)!;

    expect(Math.max(plan.width, plan.height)).toBeLessThanOrEqual(2576);
  });
});

const CELL_COLUMNS = 31;
const CELL_ROWS = 10;
const CELL_PX = 40;

/** Distinct saturated color per cell so the round trip can be checked cell by cell. */
const cellColor = (column: number, row: number): [number, number, number] => [
  (column * 53) % 256 > 127 ? 230 : 20,
  (row * 97 + column * 31) % 256 > 127 ? 230 : 20,
  (column + row) % 2 === 0 ? 230 : 20,
];

const buildPattern = (): RawImage => {
  const width = CELL_COLUMNS * CELL_PX;
  const height = CELL_ROWS * CELL_PX;
  const data = Buffer.alloc(width * height * 3);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = cellColor(Math.floor(x / CELL_PX), Math.floor(y / CELL_PX));
      const offset = (y * width + x) * 3;

      data[offset] = r;
      data[offset + 1] = g;
      data[offset + 2] = b;
    }
  }

  return { data, width, height };
};

/** Photo-like image: the flat pattern projected into `quad` of a larger white canvas. */
const projectPattern = (pattern: RawImage, quad: Quad, width: number, height: number): RawImage => {
  const patternRect: Quad = [
    { x: 0, y: 0 },
    { x: pattern.width, y: 0 },
    { x: pattern.width, y: pattern.height },
    { x: 0, y: pattern.height },
  ];

  return warpRaw(pattern, width, height, solveHomography(quad, patternRect)!);
};

const toGrid = (quad: Quad, width: number, height: number): GridCorners => {
  const [topLeft, topRight, bottomRight, bottomLeft] = quad.map((point) => ({
    x: (point.x / width) * 1000,
    y: (point.y / height) * 1000,
  }));

  return { topLeft: topLeft!, topRight: topRight!, bottomRight: bottomRight!, bottomLeft: bottomLeft! };
};

const encodeJpeg = async (raw: RawImage) =>
  sharp(raw.data, { raw: { width: raw.width, height: raw.height, channels: 3 } })
    .jpeg({ quality: 95 })
    .toBuffer();

describe('warpToGrid', () => {
  it('flattens a perspective-skewed grid so every cell lands in its column/row', async () => {
    const pattern = buildPattern();
    const photo = projectPattern(pattern, SKEWED, 1536, 1152);
    const result = await warpToGrid(
      { bytes: await encodeJpeg(photo), mime: ImageMimeType.JPEG },
      toGrid(SKEWED, 1536, 1152),
    );

    expect(result).not.toBeNull();

    const { raw, dayGrid, image } = result!;
    const cellWidth = (dayGrid.right - dayGrid.left) / CELL_COLUMNS;
    const cellHeight = (dayGrid.bottom - dayGrid.top) / CELL_ROWS;
    let mismatches = 0;

    for (let row = 0; row < CELL_ROWS; row += 1) {
      for (let column = 0; column < CELL_COLUMNS; column += 1) {
        const x = Math.round(dayGrid.left + (column + 0.5) * cellWidth);
        const y = Math.round(dayGrid.top + (row + 0.5) * cellHeight);
        const offset = (y * raw.width + x) * 3;
        const expected = cellColor(column, row);
        const actual = [raw.data[offset], raw.data[offset + 1], raw.data[offset + 2]];

        if (expected.some((value, channel) => Math.abs(value - (actual[channel] ?? 0)) > 60)) {
          mismatches += 1;
        }
      }
    }

    expect(mismatches).toBe(0);
    expect(image.mime).toBe(ImageMimeType.JPEG);

    const metadata = await sharp(image.bytes).metadata();

    expect([metadata.width, metadata.height, metadata.format]).toEqual([raw.width, raw.height, 'jpeg']);
  });

  it('returns null for missing or invalid corners (callers fall back to the original)', async () => {
    const photo = await encodeJpeg({ data: Buffer.alloc(400 * 300 * 3, 255), width: 400, height: 300 });
    const image = { bytes: photo, mime: ImageMimeType.JPEG };
    const tiny: GridCorners = {
      topLeft: { x: 10, y: 10 },
      topRight: { x: 50, y: 10 },
      bottomRight: { x: 50, y: 50 },
      bottomLeft: { x: 10, y: 50 },
    };

    expect(await warpToGrid(image, null)).toBeNull();
    expect(await warpToGrid(image, undefined)).toBeNull();
    expect(await warpToGrid(image, tiny)).toBeNull();
  });

  it('warps to a 2576px-wide output in reasonable time', async () => {
    const width = 4000;
    const height = 3000;
    const quad: Quad = [
      { x: 700, y: 500 },
      { x: 3900, y: 350 },
      { x: 3950, y: 2600 },
      { x: 600, y: 2800 },
    ];
    const pattern = buildPattern();
    const photo = projectPattern(pattern, quad, width, height);
    const bytes = await encodeJpeg(photo);
    const startedAt = performance.now();
    const result = await warpToGrid({ bytes, mime: ImageMimeType.JPEG }, toGrid(quad, width, height));
    const elapsedMs = performance.now() - startedAt;

    expect(result).not.toBeNull();
    expect(result!.raw.width).toBe(2576);
    // Timing is informative only (machines differ); correctness is asserted above.
    console.info(`[PerspectiveWarp] 2576px warp incl. decode/encode: ${Math.round(elapsedMs)}ms`);
  });
});

describe('toPixelQuad', () => {
  it('converts normalized 0–1000 corners to pixels in TL, TR, BR, BL order', () => {
    const quad = toPixelQuad(
      {
        topLeft: { x: 0, y: 0 },
        topRight: { x: 1000, y: 0 },
        bottomRight: { x: 1000, y: 500 },
        bottomLeft: { x: 0, y: 500 },
      },
      2000,
      1000,
    );

    expect(quad).toEqual([
      { x: 0, y: 0 },
      { x: 2000, y: 0 },
      { x: 2000, y: 500 },
      { x: 0, y: 500 },
    ]);
  });
});
