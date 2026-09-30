import { type PixelPoint, type Quad, type RawImage } from '@/server/vision/PerspectiveWarp';

/** Tilt range searched around each rough edge, and its step (degrees). */
const MAX_TILT_DEG = 15;
const TILT_STEP_DEG = 0.2;
/** Band around a horizontal edge, as a share of the quad height (covers several row lines). */
const HORIZONTAL_BAND_SHARE = 0.12;
/** Band around a vertical edge, as a share of the quad width (covers a few column lines). */
const VERTICAL_BAND_SHARE = 0.06;
/** Ends of the edge are skipped (corners mix both line directions). */
const EDGE_TRIM_SHARE = 0.06;
/** Pixels darker than this share of the band's mean gray count as line ink. */
const INK_SHARE = 0.75;
/** Sampling step along the edge (px); across the edge every pixel is used for 1px resolution. */
const ALONG_STEP = 2;
/** A refined corner may move at most this share of the quad diagonal. */
const MAX_CORNER_SHIFT_SHARE = 0.15;

type Line = { point: PixelPoint; direction: PixelPoint };

type InkSample = { along: number; across: number; weight: number };

const DEG = Math.PI / 180;

const sub = (a: PixelPoint, b: PixelPoint): PixelPoint => ({ x: a.x - b.x, y: a.y - b.y });

const length = (vector: PixelPoint): number => Math.hypot(vector.x, vector.y);

const grayAt = (image: RawImage, x: number, y: number): number => {
  const offset = (y * image.width + x) * 3;

  return (image.data[offset]! * 299 + image.data[offset + 1]! * 587 + image.data[offset + 2]! * 114) / 1000;
};

/** Dark pixels in a band around the edge, in (along, across) coordinates relative to its midpoint. */
const collectInk = (image: RawImage, from: PixelPoint, to: PixelPoint, halfBand: number): InkSample[] => {
  const edge = sub(to, from);
  const edgeLength = length(edge);
  const tangent = { x: edge.x / edgeLength, y: edge.y / edgeLength };
  const normal = { x: -tangent.y, y: tangent.x };
  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  const halfAlong = edgeLength / 2 - edgeLength * EDGE_TRIM_SHARE;
  const raw: InkSample[] = [];
  let graySum = 0;

  for (let along = -halfAlong; along <= halfAlong; along += ALONG_STEP) {
    for (let across = -halfBand; across <= halfBand; across += 1) {
      const x = Math.round(mid.x + along * tangent.x + across * normal.x);
      const y = Math.round(mid.y + along * tangent.y + across * normal.y);

      if (x < 0 || y < 0 || x >= image.width || y >= image.height) {
        continue;
      }

      const gray = grayAt(image, x, y);

      graySum += gray;
      raw.push({ along, across, weight: gray });
    }
  }

  if (raw.length === 0) {
    return [];
  }

  const threshold = (graySum / raw.length) * INK_SHARE;

  return raw.flatMap((sample) =>
    sample.weight < threshold ? [{ ...sample, weight: threshold - sample.weight }] : [],
  );
};

/**
 * Projection-profile deskew: the tilt (relative to the rough edge) at which the ink projected across the
 * edge forms the sharpest peaks, i.e. where the grid lines near the edge run parallel to it.
 */
const findTilt = (ink: InkSample[], halfBand: number): number => {
  const binOffset = Math.ceil(halfBand * 2) + 2;
  const bins = new Float64Array(binOffset * 2 + 1);
  let bestTilt = 0;
  let bestScore = -1;

  for (let tiltDeg = -MAX_TILT_DEG; tiltDeg <= MAX_TILT_DEG + 1e-9; tiltDeg += TILT_STEP_DEG) {
    const sin = Math.sin(tiltDeg * DEG);
    const cos = Math.cos(tiltDeg * DEG);

    bins.fill(0);

    for (const sample of ink) {
      const bin = Math.round(sample.across * cos - sample.along * sin) + binOffset;

      if (bin >= 0 && bin < bins.length) {
        bins[bin]! += sample.weight;
      }
    }

    let score = 0;

    for (const value of bins) {
      score += value * value;
    }

    // Prefer the untouched edge on ties (blank bands).
    if (score > bestScore * (1 + 1e-9) || (score === bestScore && Math.abs(tiltDeg) < Math.abs(bestTilt))) {
      bestScore = score;
      bestTilt = tiltDeg;
    }
  }

  return bestTilt * DEG;
};

/** The edge rotated about its midpoint to follow the nearby grid lines. */
const refineEdge = (image: RawImage, from: PixelPoint, to: PixelPoint, halfBand: number): Line => {
  const direction = sub(to, from);
  const point = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  const ink = collectInk(image, from, to, halfBand);

  if (ink.length === 0) {
    return { point, direction };
  }

  const tilt = findTilt(ink, halfBand);
  const cos = Math.cos(tilt);
  const sin = Math.sin(tilt);

  return {
    point,
    direction: { x: direction.x * cos - direction.y * sin, y: direction.x * sin + direction.y * cos },
  };
};

const intersect = (a: Line, b: Line): PixelPoint | null => {
  const denominator = a.direction.x * b.direction.y - a.direction.y * b.direction.x;

  if (Math.abs(denominator) < 1e-9) {
    return null;
  }

  const delta = sub(b.point, a.point);
  const t = (delta.x * b.direction.y - delta.y * b.direction.x) / denominator;

  return { x: a.point.x + a.direction.x * t, y: a.point.y + a.direction.y * t };
};

/**
 * Corrects the tilt of each edge of a rough model quad from the table's own grid lines (models localize
 * the table but often return a near-rectangle for a tilted photo). Edge midpoints (the extent) are kept;
 * only directions change. Returns the input when a refined corner would be implausible.
 */
export const refineQuad = (image: RawImage, quad: Quad): Quad => {
  const [topLeft, topRight, bottomRight, bottomLeft] = quad;
  const quadHeight = (length(sub(bottomLeft, topLeft)) + length(sub(bottomRight, topRight))) / 2;
  const quadWidth = (length(sub(topRight, topLeft)) + length(sub(bottomRight, bottomLeft))) / 2;
  const horizontalBand = quadHeight * HORIZONTAL_BAND_SHARE;
  const verticalBand = quadWidth * VERTICAL_BAND_SHARE;
  const top = refineEdge(image, topLeft, topRight, horizontalBand);
  const bottom = refineEdge(image, bottomLeft, bottomRight, horizontalBand);
  const left = refineEdge(image, topLeft, bottomLeft, verticalBand);
  const right = refineEdge(image, topRight, bottomRight, verticalBand);
  const corners = [
    intersect(top, left),
    intersect(top, right),
    intersect(bottom, right),
    intersect(bottom, left),
  ];
  const maxShift = Math.hypot(quadWidth, quadHeight) * MAX_CORNER_SHIFT_SHARE;
  const plausible = corners.every(
    (corner, index) => corner !== null && length(sub(corner, quad[index]!)) <= maxShift,
  );

  return plausible ? (corners as Quad) : quad;
};
