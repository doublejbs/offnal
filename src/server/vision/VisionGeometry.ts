/** Shared geometry types and constants of the perspective pipeline (no image I/O here). */

/** Point in pixels (or any plane). */
export type PixelPoint = { x: number; y: number };

/** Corners in top-left, top-right, bottom-right, bottom-left order. */
export type Quad = [PixelPoint, PixelPoint, PixelPoint, PixelPoint];

/** Row-major 3×3 projective matrix with h[8] = 1. */
export type Homography = readonly number[];

/** Tightly packed 8-bit RGB pixels. */
export type RawImage = { data: Buffer; width: number; height: number };

export type PixelRect = { left: number; top: number; right: number; bottom: number };

/** Bytes per pixel of every raw buffer in the pipeline (RGB, alpha removed). */
export const CHANNELS = 3;

/** Upper bound of the model's normalized coordinates (0–1000 of width/height). */
export const NORMALIZED_MAX = 1000;

/** ITU-R BT.601 luma weights (per mille) for RGB → gray. */
export const LUMA_WEIGHTS = { red: 299, green: 587, blue: 114, total: 1000 } as const;

export const subtractPoints = (a: PixelPoint, b: PixelPoint): PixelPoint => ({ x: a.x - b.x, y: a.y - b.y });

export const measureLength = (vector: PixelPoint): number => Math.hypot(vector.x, vector.y);

export const measureDistance = (a: PixelPoint, b: PixelPoint): number => measureLength(subtractPoints(a, b));

/** Shoelace area of a polygon. */
export const computeQuadArea = (quad: Quad): number =>
  Math.abs(
    quad.reduce((sum, point, index) => {
      const next = quad[(index + 1) % quad.length]!;

      return sum + point.x * next.y - next.x * point.y;
    }, 0),
  ) / 2;
