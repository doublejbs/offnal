import { type PixelPoint } from '@/server/vision/VisionGeometry';

/** Sample point of a border: `along` the edge direction, `across` it (s = slope · t + intercept). */
export type EdgeSample = { along: number; across: number };

/** across = slope · along + intercept. */
export type EdgeLine = { slope: number; intercept: number; inliers: number };

/** At most this many evenly picked samples seed the pair search (keeps it O(n²) small). */
const MAX_SEEDS = 80;
/** Seed pairs must be at least this share of the sampled range apart (short baselines tilt wildly). */
const MIN_SEED_SPAN_SHARE = 0.2;

const fitLeastSquares = (samples: EdgeSample[]): { slope: number; intercept: number } | null => {
  const count = samples.length;

  if (count < 2) {
    return null;
  }

  const meanAlong = samples.reduce((sum, sample) => sum + sample.along, 0) / count;
  const meanAcross = samples.reduce((sum, sample) => sum + sample.across, 0) / count;
  let covariance = 0;
  let variance = 0;

  for (const sample of samples) {
    covariance += (sample.along - meanAlong) * (sample.across - meanAcross);
    variance += (sample.along - meanAlong) ** 2;
  }

  if (variance === 0) {
    return null;
  }

  const slope = covariance / variance;

  return { slope, intercept: meanAcross - slope * meanAlong };
};

/**
 * Deterministic RANSAC: every pair of evenly spaced seed samples proposes a line, the one with the most
 * samples within `tolerance` wins and is refit by least squares on its inliers. Robust to border pieces
 * that belong to something else (an approval box touching the table, the legend's frame line).
 */
export const fitEdgeLine = (samples: EdgeSample[], tolerance: number): EdgeLine | null => {
  if (samples.length < 2) {
    return null;
  }

  const step = Math.max(1, Math.floor(samples.length / MAX_SEEDS));
  const seeds = samples.filter((_sample, index) => index % step === 0);
  const alongValues = samples.map((sample) => sample.along);
  const minSpan = (Math.max(...alongValues) - Math.min(...alongValues)) * MIN_SEED_SPAN_SHARE;
  let best: { slope: number; intercept: number; inliers: number } | null = null;

  for (let first = 0; first < seeds.length; first += 1) {
    for (let second = first + 1; second < seeds.length; second += 1) {
      const a = seeds[first]!;
      const b = seeds[second]!;

      if (Math.abs(b.along - a.along) < Math.max(1, minSpan)) {
        continue;
      }

      const slope = (b.across - a.across) / (b.along - a.along);
      const intercept = a.across - slope * a.along;
      let inliers = 0;

      for (const sample of samples) {
        if (Math.abs(sample.across - (slope * sample.along + intercept)) <= tolerance) {
          inliers += 1;
        }
      }

      if (!best || inliers > best.inliers) {
        best = { slope, intercept, inliers };
      }
    }
  }

  if (!best) {
    return null;
  }

  const { slope, intercept } = best;
  const inlierSamples = samples.filter(
    (sample) => Math.abs(sample.across - (slope * sample.along + intercept)) <= tolerance,
  );
  const refined = fitLeastSquares(inlierSamples);

  return refined ? { ...refined, inliers: inlierSamples.length } : best;
};

/** Intersection of y = h.slope·x + h.intercept (horizontal edge) and x = v.slope·y + v.intercept (vertical). */
export const intersectEdges = (horizontal: EdgeLine, vertical: EdgeLine): PixelPoint | null => {
  const denominator = 1 - horizontal.slope * vertical.slope;

  if (Math.abs(denominator) < 1e-9) {
    return null;
  }

  const x = (vertical.slope * horizontal.intercept + vertical.intercept) / denominator;

  return { x, y: horizontal.slope * x + horizontal.intercept };
};
