import {
  CHANNELS,
  LUMA_WEIGHTS,
  measureDistance,
  measureLength,
  type PixelPoint,
  type Quad,
  type RawImage,
  subtractPoints,
} from '@/server/vision/VisionGeometry';

/** Refinement runs on a gray copy whose long edge is at most this (integer box downscale). */
export const REFINE_MAX_EDGE_PX = 1024;

/** Tilt range searched around each rough edge, and its step (degrees). */
const MAX_TILT_DEG = 15;
const TILT_STEP_DEG = 0.2;
/**
 * Half-width of the band scanned on each side of a horizontal edge, as a share of the quad height (the
 * full band, twice this, covers several row lines).
 */
const HORIZONTAL_HALF_BAND_SHARE = 0.12;
/** Half-width of the band on each side of a vertical edge, as a share of the quad width (a few columns). */
const VERTICAL_HALF_BAND_SHARE = 0.06;
/** Ends of the edge are skipped (corners mix both line directions). */
const EDGE_TRIM_SHARE = 0.06;
/** Pixels darker than this share of the band's mean gray count as line ink. */
const INK_SHARE = 0.75;

/** A refined corner may move at most this share of the quad diagonal. */
export const MAX_CORNER_SHIFT_SHARE = 0.15;

/** Parallel-line determinant below this = no intersection. */
const PARALLEL_EPSILON = 1e-9;
/** Relative score gain needed to prefer another tilt (ties keep the smaller tilt). */
const SCORE_TIE_EPSILON = 1e-9;
/** Floats per ink sample: along, across, weight. */
const SAMPLE_STRIDE = 3;

const DEG = Math.PI / 180;

type Line = { point: PixelPoint; direction: PixelPoint };

type GrayImage = { data: Uint8Array; width: number; height: number };

/** Ink samples packed as [along, across, weight, …] (no per-sample objects). */
type InkSamples = { values: Float32Array; count: number };

/** Box-averaged luma copy, downscaled by an integer factor so the long edge is ≤ `maxEdge`. */
const toDownscaledGray = (image: RawImage, maxEdge: number): { gray: GrayImage; factor: number } => {
  const factor = Math.max(1, Math.ceil(Math.max(image.width, image.height) / maxEdge));
  const width = Math.floor(image.width / factor);
  const height = Math.floor(image.height / factor);
  const data = new Uint8Array(width * height);
  const divisor = factor * factor * LUMA_WEIGHTS.total;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;

      for (let dy = 0; dy < factor; dy += 1) {
        let offset = ((y * factor + dy) * image.width + x * factor) * CHANNELS;

        for (let dx = 0; dx < factor; dx += 1) {
          sum +=
            image.data[offset]! * LUMA_WEIGHTS.red +
            image.data[offset + 1]! * LUMA_WEIGHTS.green +
            image.data[offset + 2]! * LUMA_WEIGHTS.blue;
          offset += CHANNELS;
        }
      }

      data[y * width + x] = sum / divisor;
    }
  }

  return { gray: { data, width, height }, factor };
};

type BandGeometry = {
  mid: PixelPoint;
  tangent: PixelPoint;
  normal: PixelPoint;
  halfAlong: number;
  halfBand: number;
};

const describeBand = (from: PixelPoint, to: PixelPoint, halfBand: number): BandGeometry => {
  const edge = subtractPoints(to, from);
  const edgeLength = measureLength(edge);
  const tangent = { x: edge.x / edgeLength, y: edge.y / edgeLength };

  return {
    mid: { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 },
    tangent,
    normal: { x: -tangent.y, y: tangent.x },
    halfAlong: edgeLength / 2 - edgeLength * EDGE_TRIM_SHARE,
    halfBand,
  };
};

/** Visits every band pixel inside the image with its (along, across) offsets from the edge midpoint. */
const visitBand = (
  gray: GrayImage,
  band: BandGeometry,
  visit: (along: number, across: number, value: number) => void,
): void => {
  const { mid, tangent, normal, halfAlong, halfBand } = band;

  for (let along = -halfAlong; along <= halfAlong; along += 1) {
    for (let across = -halfBand; across <= halfBand; across += 1) {
      const x = Math.round(mid.x + along * tangent.x + across * normal.x);
      const y = Math.round(mid.y + along * tangent.y + across * normal.y);

      if (x >= 0 && y >= 0 && x < gray.width && y < gray.height) {
        visit(along, across, gray.data[y * gray.width + x]!);
      }
    }
  }
};

/** Two passes: the band's mean gray, then the pixels darker than INK_SHARE of it (weight = darkness). */
const collectInk = (gray: GrayImage, band: BandGeometry): InkSamples => {
  let graySum = 0;
  let pixelCount = 0;

  visitBand(gray, band, (_along, _across, value) => {
    graySum += value;
    pixelCount += 1;
  });

  const values = new Float32Array(pixelCount * SAMPLE_STRIDE);

  if (pixelCount === 0) {
    return { values, count: 0 };
  }

  const threshold = (graySum / pixelCount) * INK_SHARE;
  let count = 0;

  visitBand(gray, band, (along, across, value) => {
    if (value < threshold) {
      const offset = count * SAMPLE_STRIDE;

      values[offset] = along;
      values[offset + 1] = across;
      values[offset + 2] = threshold - value;
      count += 1;
    }
  });

  return { values, count };
};

/**
 * Projection-profile deskew: the tilt (relative to the rough edge) at which the ink projected across the
 * edge forms the sharpest peaks, i.e. where the grid lines near the edge run parallel to it.
 */
const findTilt = (ink: InkSamples, halfBand: number): number => {
  const binOffset = Math.ceil(halfBand * 2) + 2;
  const bins = new Float64Array(binOffset * 2 + 1);
  let bestTilt = 0;
  let bestScore = -1;

  for (let tiltDeg = -MAX_TILT_DEG; tiltDeg <= MAX_TILT_DEG + SCORE_TIE_EPSILON; tiltDeg += TILT_STEP_DEG) {
    const sin = Math.sin(tiltDeg * DEG);
    const cos = Math.cos(tiltDeg * DEG);

    bins.fill(0);

    for (let index = 0; index < ink.count; index += 1) {
      const offset = index * SAMPLE_STRIDE;
      const bin = Math.round(ink.values[offset + 1]! * cos - ink.values[offset]! * sin) + binOffset;

      if (bin >= 0 && bin < bins.length) {
        bins[bin]! += ink.values[offset + 2]!;
      }
    }

    let score = 0;

    for (const value of bins) {
      score += value * value;
    }

    if (
      score > bestScore * (1 + SCORE_TIE_EPSILON) ||
      (score === bestScore && Math.abs(tiltDeg) < Math.abs(bestTilt))
    ) {
      bestScore = score;
      bestTilt = tiltDeg;
    }
  }

  return bestTilt * DEG;
};

/** The edge rotated about its midpoint to follow the nearby grid lines. */
const refineEdge = (gray: GrayImage, from: PixelPoint, to: PixelPoint, halfBand: number): Line => {
  const band = describeBand(from, to, halfBand);
  const direction = subtractPoints(to, from);
  const ink = collectInk(gray, band);

  if (ink.count === 0) {
    return { point: band.mid, direction };
  }

  const tilt = findTilt(ink, halfBand);
  const cos = Math.cos(tilt);
  const sin = Math.sin(tilt);

  return {
    point: band.mid,
    direction: { x: direction.x * cos - direction.y * sin, y: direction.x * sin + direction.y * cos },
  };
};

const intersectLines = (a: Line, b: Line): PixelPoint | null => {
  const denominator = a.direction.x * b.direction.y - a.direction.y * b.direction.x;

  if (Math.abs(denominator) < PARALLEL_EPSILON) {
    return null;
  }

  const delta = subtractPoints(b.point, a.point);
  const t = (delta.x * b.direction.y - delta.y * b.direction.x) / denominator;

  return { x: a.point.x + a.direction.x * t, y: a.point.y + a.direction.y * t };
};

/** Every refined corner exists and moved at most MAX_CORNER_SHIFT_SHARE of the quad diagonal. */
export const isPlausibleRefinement = (quad: Quad, refined: (PixelPoint | null)[]): refined is Quad => {
  const [topLeft, topRight, bottomRight, bottomLeft] = quad;
  const width = (measureDistance(topLeft, topRight) + measureDistance(bottomLeft, bottomRight)) / 2;
  const height = (measureDistance(topLeft, bottomLeft) + measureDistance(topRight, bottomRight)) / 2;
  const maxShift = Math.hypot(width, height) * MAX_CORNER_SHIFT_SHARE;

  return (
    refined.length === quad.length &&
    refined.every((corner, index) => corner !== null && measureDistance(corner, quad[index]!) <= maxShift)
  );
};

const scaleQuad = (quad: Quad, scale: number): Quad =>
  quad.map((point) => ({ x: point.x * scale, y: point.y * scale })) as Quad;

/**
 * Corrects the tilt of each edge of a rough model quad from the table's own grid lines (models localize
 * the table but often return a near-rectangle for a tilted photo). Edge midpoints (the extent) are kept;
 * only directions change. Works on a ≤ 1024px gray copy. Returns the input when a refined corner would be
 * implausible (moved more than MAX_CORNER_SHIFT_SHARE of the diagonal, or parallel edges).
 */
export const refineQuad = (image: RawImage, quad: Quad, maxEdge: number = REFINE_MAX_EDGE_PX): Quad => {
  const { gray, factor } = toDownscaledGray(image, maxEdge);
  const small = scaleQuad(quad, 1 / factor);
  const [topLeft, topRight, bottomRight, bottomLeft] = small;
  const quadHeight =
    (measureLength(subtractPoints(bottomLeft, topLeft)) +
      measureLength(subtractPoints(bottomRight, topRight))) /
    2;
  const quadWidth =
    (measureLength(subtractPoints(topRight, topLeft)) +
      measureLength(subtractPoints(bottomRight, bottomLeft))) /
    2;
  const horizontalHalfBand = quadHeight * HORIZONTAL_HALF_BAND_SHARE;
  const verticalHalfBand = quadWidth * VERTICAL_HALF_BAND_SHARE;
  const top = refineEdge(gray, topLeft, topRight, horizontalHalfBand);
  const bottom = refineEdge(gray, bottomLeft, bottomRight, horizontalHalfBand);
  const left = refineEdge(gray, topLeft, bottomLeft, verticalHalfBand);
  const right = refineEdge(gray, topRight, bottomRight, verticalHalfBand);
  const corners = [
    intersectLines(top, left),
    intersectLines(top, right),
    intersectLines(bottom, right),
    intersectLines(bottom, left),
  ];
  const plausible = isPlausibleRefinement(small, corners);

  return plausible ? scaleQuad(corners, factor) : quad;
};
