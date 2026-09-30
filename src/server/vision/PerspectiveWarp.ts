import sharp from 'sharp';

import { ImageMimeType } from '@/domain/enums/ImageMimeType';
import { type GridCorners } from '@/domain/types/GridCorners';
import { refineQuad } from '@/server/vision/QuadRefiner';
import { VISION_MAX_EDGE_PX } from '@/server/vision/VisionImagePreparer';
import { type VisionImage } from '@/server/vision/VisionProvider';

/** Point in pixels (or any plane). */
export type PixelPoint = { x: number; y: number };

/** Corners in top-left, top-right, bottom-right, bottom-left order. */
export type Quad = [PixelPoint, PixelPoint, PixelPoint, PixelPoint];

/** Row-major 3×3 projective matrix with h[8] = 1. */
export type Homography = readonly number[];

/** Tightly packed 8-bit RGB pixels. */
export type RawImage = { data: Buffer; width: number; height: number };

export type PixelRect = { left: number; top: number; right: number; bottom: number };

export type WarpPlan = {
  width: number;
  height: number;
  /** Where the day grid lands in the output (pixels). */
  dayGrid: PixelRect;
};

export type WarpResult = {
  /** JPEG of the flattened table (memory only, never stored). */
  image: VisionImage;
  raw: RawImage;
  dayGrid: PixelRect;
  /** Source-pixel quad actually used (the model's corners after tilt refinement). */
  quad: Quad;
};

/**
 * Extra area around the day grid, as fractions of the grid width/height. The left margin brings the name
 * column into the flattened image (the homography extends past the corners because the sheet is planar),
 * so row location and the strip can show the name next to the cells. The other margins absorb extent
 * errors of the model's corners (refinement fixes their tilt, not their position).
 */
export const WARP_MARGINS = { left: 0.2, right: 0.05, top: 0.06, bottom: 0.05 } as const;

/** Corners must enclose at least this share of the image. */
export const WARP_MIN_AREA_RATIO = 0.1;

const JPEG_QUALITY = 90;
const NORMALIZED_MAX = 1000;
/** Corner coordinates may sit slightly outside the image (cut-off borders). */
const CORNER_TOLERANCE = 0.02;
const PIVOT_EPSILON = 1e-10;
const WHITE = 255;
const CHANNELS = 3;

/**
 * Solves the homography mapping each `from` corner onto the matching `to` corner: the 8×8 linear system
 * of the standard DLT form with h[8] = 1, by Gaussian elimination with partial pivoting.
 * Returns null when the system is singular (collinear/degenerate points).
 */
export const solveHomography = (from: Quad, to: Quad): Homography | null => {
  const rows: number[][] = [];

  from.forEach((source, index) => {
    const target = to[index]!;

    rows.push([source.x, source.y, 1, 0, 0, 0, -target.x * source.x, -target.x * source.y, target.x]);
    rows.push([0, 0, 0, source.x, source.y, 1, -target.y * source.x, -target.y * source.y, target.y]);
  });

  const size = 8;

  for (let column = 0; column < size; column += 1) {
    let pivotRow = column;

    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(rows[row]![column]!) > Math.abs(rows[pivotRow]![column]!)) {
        pivotRow = row;
      }
    }

    const scale = Math.max(1, ...rows.map((row) => Math.abs(row[column]!)));

    if (Math.abs(rows[pivotRow]![column]!) / scale < PIVOT_EPSILON) {
      return null;
    }

    [rows[column], rows[pivotRow]] = [rows[pivotRow]!, rows[column]!];

    const pivot = rows[column]!;

    for (let row = column + 1; row < size; row += 1) {
      const current = rows[row]!;
      const factor = current[column]! / pivot[column]!;

      for (let index = column; index <= size; index += 1) {
        current[index] = current[index]! - factor * pivot[index]!;
      }
    }
  }

  const solution = new Array<number>(size).fill(0);

  for (let row = size - 1; row >= 0; row -= 1) {
    const current = rows[row]!;
    let sum = current[size]!;

    for (let index = row + 1; index < size; index += 1) {
      sum -= current[index]! * solution[index]!;
    }

    solution[row] = sum / current[row]!;
  }

  return solution.every(Number.isFinite) ? [...solution, 1] : null;
};

export const applyHomography = (h: Homography, point: PixelPoint): PixelPoint => {
  const w = h[6]! * point.x + h[7]! * point.y + h[8]!;

  return {
    x: (h[0]! * point.x + h[1]! * point.y + h[2]!) / w,
    y: (h[3]! * point.x + h[4]! * point.y + h[5]!) / w,
  };
};

export const toPixelQuad = (grid: GridCorners, width: number, height: number): Quad =>
  [grid.topLeft, grid.topRight, grid.bottomRight, grid.bottomLeft].map((point) => ({
    x: (point.x / NORMALIZED_MAX) * width,
    y: (point.y / NORMALIZED_MAX) * height,
  })) as Quad;

const cross = (origin: PixelPoint, a: PixelPoint, b: PixelPoint): number =>
  (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x);

const quadArea = (quad: Quad): number =>
  Math.abs(
    quad.reduce((sum, point, index) => {
      const next = quad[(index + 1) % quad.length]!;

      return sum + point.x * next.y - next.x * point.y;
    }, 0),
  ) / 2;

/**
 * Finite, inside the image (small tolerance), strictly convex in TL→TR→BR→BL order (clockwise with the
 * y axis pointing down, which also rejects mirrored/swapped corner orders) and ≥ 10% of the image area.
 */
export const isValidQuad = (quad: Quad, width: number, height: number): boolean => {
  const inside = quad.every(
    (point) =>
      Number.isFinite(point.x) &&
      Number.isFinite(point.y) &&
      point.x >= -width * CORNER_TOLERANCE &&
      point.x <= width * (1 + CORNER_TOLERANCE) &&
      point.y >= -height * CORNER_TOLERANCE &&
      point.y <= height * (1 + CORNER_TOLERANCE),
  );

  if (!inside) {
    return false;
  }

  const convex = quad.every(
    (point, index) => cross(point, quad[(index + 1) % 4]!, quad[(index + 2) % 4]!) > 0,
  );

  return convex && quadArea(quad) >= width * height * WARP_MIN_AREA_RATIO;
};

const distance = (a: PixelPoint, b: PixelPoint): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Output size from the mean opposite edge lengths plus margins, long edge ≤ `maxEdge` (never enlarged). */
export const planWarp = (quad: Quad, maxEdge: number = VISION_MAX_EDGE_PX): WarpPlan | null => {
  const [topLeft, topRight, bottomRight, bottomLeft] = quad;
  const gridWidth = (distance(topLeft, topRight) + distance(bottomLeft, bottomRight)) / 2;
  const gridHeight = (distance(topLeft, bottomLeft) + distance(topRight, bottomRight)) / 2;
  const fullWidth = gridWidth * (1 + WARP_MARGINS.left + WARP_MARGINS.right);
  const fullHeight = gridHeight * (1 + WARP_MARGINS.top + WARP_MARGINS.bottom);
  const scale = Math.min(1, maxEdge / Math.max(fullWidth, fullHeight));
  const width = Math.round(fullWidth * scale);
  const height = Math.round(fullHeight * scale);

  if (!Number.isFinite(scale) || width < 16 || height < 16) {
    return null;
  }

  const left = gridWidth * WARP_MARGINS.left * scale;
  const top = gridHeight * WARP_MARGINS.top * scale;

  return {
    width,
    height,
    dayGrid: { left, top, right: left + gridWidth * scale, bottom: top + gridHeight * scale },
  };
};

/**
 * Inverse mapping: for every output pixel center, `outputToSource` gives the source position, sampled
 * bilinearly (outside the source → white). Numerators/denominator are stepped incrementally per row.
 */
export const warpRaw = (
  source: RawImage,
  width: number,
  height: number,
  outputToSource: Homography,
): RawImage => {
  const h = outputToSource;
  const out = Buffer.alloc(width * height * CHANNELS, WHITE);
  const src = source.data;
  const srcWidth = source.width;
  const maxX = source.width - 1;
  const maxY = source.height - 1;
  const h0 = h[0]!;
  const h3 = h[3]!;
  const h6 = h[6]!;

  for (let y = 0; y < height; y += 1) {
    const cy = y + 0.5;
    let u = h0 * 0.5 + h[1]! * cy + h[2]!;
    let v = h3 * 0.5 + h[4]! * cy + h[5]!;
    let w = h6 * 0.5 + h[7]! * cy + h[8]!;
    let outOffset = y * width * CHANNELS;

    for (let x = 0; x < width; x += 1) {
      // Source pixel i covers [i, i+1): its center is i + 0.5.
      const sx = u / w - 0.5;
      const sy = v / w - 0.5;

      if (sx >= 0 && sy >= 0 && sx <= maxX && sy <= maxY) {
        const x0 = Math.floor(sx);
        const y0 = Math.floor(sy);
        const x1 = x0 < maxX ? x0 + 1 : x0;
        const y1 = y0 < maxY ? y0 + 1 : y0;
        const fx = sx - x0;
        const fy = sy - y0;
        const topRow = y0 * srcWidth;
        const bottomRow = y1 * srcWidth;
        const a = (topRow + x0) * CHANNELS;
        const b = (topRow + x1) * CHANNELS;
        const c = (bottomRow + x0) * CHANNELS;
        const d = (bottomRow + x1) * CHANNELS;
        const wa = (1 - fx) * (1 - fy);
        const wb = fx * (1 - fy);
        const wc = (1 - fx) * fy;
        const wd = fx * fy;

        out[outOffset] = src[a]! * wa + src[b]! * wb + src[c]! * wc + src[d]! * wd + 0.5;
        out[outOffset + 1] = src[a + 1]! * wa + src[b + 1]! * wb + src[c + 1]! * wc + src[d + 1]! * wd + 0.5;
        out[outOffset + 2] = src[a + 2]! * wa + src[b + 2]! * wb + src[c + 2]! * wc + src[d + 2]! * wd + 0.5;
      }

      outOffset += CHANNELS;
      u += h0;
      v += h3;
      w += h6;
    }
  }

  return { data: out, width, height };
};

export const decodeRaw = async (bytes: Buffer): Promise<RawImage> => {
  const { data, info } = await sharp(bytes)
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (info.channels !== CHANNELS) {
    throw new Error(`Unexpected channel count ${info.channels}`);
  }

  return { data, width: info.width, height: info.height };
};

export const encodeRawJpeg = async (raw: RawImage, quality = JPEG_QUALITY): Promise<Buffer> =>
  sharp(raw.data, { raw: { width: raw.width, height: raw.height, channels: CHANNELS } })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();

/**
 * Flattens the day grid of `image` (the provider copy the corners were read from). Returns null when the
 * corners are missing or implausible; callers then use the original image (not a failure).
 */
export const warpToGrid = async (
  image: VisionImage,
  grid: GridCorners | null | undefined,
): Promise<WarpResult | null> => {
  if (!grid) {
    return null;
  }

  const source = await decodeRaw(image.bytes);
  const quad = toPixelQuad(grid, source.width, source.height);

  if (!isValidQuad(quad, source.width, source.height)) {
    return null;
  }

  const refined = refineQuad(source, quad);
  const usedQuad = isValidQuad(refined, source.width, source.height) ? refined : quad;
  const plan = planWarp(usedQuad);

  if (!plan) {
    return null;
  }

  const { dayGrid } = plan;
  const outputGrid: Quad = [
    { x: dayGrid.left, y: dayGrid.top },
    { x: dayGrid.right, y: dayGrid.top },
    { x: dayGrid.right, y: dayGrid.bottom },
    { x: dayGrid.left, y: dayGrid.bottom },
  ];
  const outputToSource = solveHomography(outputGrid, usedQuad);

  if (!outputToSource) {
    return null;
  }

  const raw = warpRaw(source, plan.width, plan.height, outputToSource);

  return {
    image: { bytes: await encodeRawJpeg(raw), mime: ImageMimeType.JPEG },
    raw,
    dayGrid,
    quad: usedQuad,
  };
};
