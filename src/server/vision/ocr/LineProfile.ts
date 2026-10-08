import { type GrayImage } from '@/server/vision/ocr/GrayRaster';
import { type PixelRect } from '@/server/vision/VisionGeometry';

/** One detected grid line: position along the profile and its peak ink count. */
export type LinePeak = { position: number; strength: number };

export type RunOptions = {
  /** Only ink runs at least this long count as line ink (text strokes are short). */
  minRun: number;
  /** Gaps up to this long do not break a run (faint or broken print). */
  maxGap: number;
};

/** Total length of the qualifying runs on one scan line; `isInk(i)` reads position i along it. */
const accumulateRuns = (length: number, isInk: (index: number) => boolean, options: RunOptions): number => {
  let total = 0;
  let runStart = -1;
  let lastInk = -1;

  const closeRun = () => {
    if (runStart >= 0 && lastInk - runStart + 1 >= options.minRun) {
      total += lastInk - runStart + 1;
    }
  };

  for (let index = 0; index < length; index += 1) {
    if (!isInk(index)) {
      continue;
    }

    if (runStart < 0 || index - lastInk - 1 > options.maxGap) {
      closeRun();
      runStart = index;
    }

    lastInk = index;
  }

  closeRun();

  return total;
};

/** Per row y of `rect`: ink pixels belonging to horizontal runs ≥ minRun (horizontal line evidence). */
export const profileHorizontalRuns = (
  mask: GrayImage,
  rect: PixelRect,
  options: RunOptions,
): Float64Array => {
  const profile = new Float64Array(rect.bottom - rect.top);

  for (let y = rect.top; y < rect.bottom; y += 1) {
    const rowOffset = y * mask.width + rect.left;

    profile[y - rect.top] = accumulateRuns(
      rect.right - rect.left,
      (index) => mask.data[rowOffset + index] === 1,
      options,
    );
  }

  return profile;
};

/** Per column x of `rect`: ink pixels belonging to vertical runs ≥ minRun (vertical line evidence). */
export const profileVerticalRuns = (mask: GrayImage, rect: PixelRect, options: RunOptions): Float64Array => {
  const profile = new Float64Array(rect.right - rect.left);

  for (let x = rect.left; x < rect.right; x += 1) {
    profile[x - rect.left] = accumulateRuns(
      rect.bottom - rect.top,
      (index) => mask.data[(rect.top + index) * mask.width + x] === 1,
      options,
    );
  }

  return profile;
};

/**
 * Line centers of a run profile: every stretch ≥ `threshold` becomes one peak at its weighted center, and
 * peaks closer than `mergeDistance` merge into one (thick or doubled separator lines).
 */
export const findLinePeaks = (
  profile: ArrayLike<number>,
  threshold: number,
  mergeDistance: number,
): LinePeak[] => {
  const peaks: (LinePeak & { mass: number })[] = [];
  let mass = 0;
  let moment = 0;
  let strength = 0;

  const flush = () => {
    if (mass > 0) {
      peaks.push({ position: moment / mass, strength, mass });
    }

    mass = 0;
    moment = 0;
    strength = 0;
  };

  for (let index = 0; index < profile.length; index += 1) {
    const value = profile[index]!;

    if (value < threshold) {
      flush();
      continue;
    }

    mass += value;
    moment += value * index;
    strength = Math.max(strength, value);
  }

  flush();

  const merged: (LinePeak & { mass: number })[] = [];

  for (const peak of peaks) {
    const previous = merged.at(-1);

    if (previous && peak.position - previous.position <= mergeDistance) {
      const total = previous.mass + peak.mass;

      previous.position = (previous.position * previous.mass + peak.position * peak.mass) / total;
      previous.strength = Math.max(previous.strength, peak.strength);
      previous.mass = total;
      continue;
    }

    merged.push({ ...peak });
  }

  return merged.map(({ position, strength: peakStrength }) => ({ position, strength: peakStrength }));
};

/**
 * Box sum over `window` neighbouring positions: a line that drifts a few pixels across the table (residual
 * tilt or paper curl after flattening) spreads its ink over several rows; the sum gathers it back.
 */
export const sumWindow = (profile: ArrayLike<number>, window: number): Float64Array => {
  const out = new Float64Array(profile.length);
  const half = Math.floor(window / 2);

  for (let index = 0; index < profile.length; index += 1) {
    let sum = 0;

    for (let offset = -half; offset <= half; offset += 1) {
      sum += profile[index + offset] ?? 0;
    }

    out[index] = sum;
  }

  return out;
};

export const median = (values: number[]): number | null => {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
};

/** Gaps below this share of the typical spacing are a spurious line (the weaker one is dropped). */
export const MIN_SPACING_SHARE = 0.55;
/** Gaps at least this many typical spacings wide hide missed lines (evenly re-inserted). */
export const SPLIT_SPACING_SHARE = 1.6;

/**
 * Evens out a run of equally spaced lines (day columns, person rows) from index `from` on: drops lines that
 * make a gap narrower than MIN_SPACING_SHARE of the median spacing and fills gaps ≥ SPLIT_SPACING_SHARE
 * spacings with evenly spaced inferred lines (strength 0). Lines before `from` (name column, header rows)
 * are kept as they are.
 */
export const regularizeLines = (lines: LinePeak[], from = 0): LinePeak[] => {
  const head = lines.slice(0, from);
  let tail = lines.slice(from);
  const spacing = median(tail.slice(1).map((line, index) => line.position - tail[index]!.position));

  if (spacing === null || spacing <= 0) {
    return lines;
  }

  for (let index = 1; index < tail.length;) {
    if (tail[index]!.position - tail[index - 1]!.position >= spacing * MIN_SPACING_SHARE) {
      index += 1;
      continue;
    }

    const dropIndex = tail[index]!.strength < tail[index - 1]!.strength ? index : index - 1;

    tail = tail.filter((_line, lineIndex) => lineIndex !== dropIndex);
  }

  const filled: LinePeak[] = [];

  tail.forEach((line, index) => {
    const previous = tail[index - 1];

    if (previous) {
      const gap = line.position - previous.position;
      const parts = Math.round(gap / spacing);

      if (gap >= spacing * SPLIT_SPACING_SHARE && parts >= 2) {
        for (let part = 1; part < parts; part += 1) {
          filled.push({ position: previous.position + (gap * part) / parts, strength: 0 });
        }
      }
    }

    filled.push(line);
  });

  return [...head, ...filled];
};
