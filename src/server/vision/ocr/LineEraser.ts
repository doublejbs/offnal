import { createGray, type GrayImage } from '@/server/vision/ocr/GrayRaster';

export type EraseOptions = {
  /** Horizontal ink runs at least this long are grid lines (a text stroke is shorter than a cell). */
  minHorizontalRun: number;
  /** Vertical ink runs at least this long are grid lines. */
  minVerticalRun: number;
  /** Pixels searched past a line for the paper/background value that replaces it. */
  searchPx: number;
};

/** Marks the pixels of ink runs ≥ `minRun` along rows (horizontal) or columns. */
const markRuns = (mask: GrayImage, lines: Uint8Array, horizontal: boolean, minRun: number): void => {
  const outer = horizontal ? mask.height : mask.width;
  const inner = horizontal ? mask.width : mask.height;
  const indexOf = (a: number, b: number) => (horizontal ? a * mask.width + b : b * mask.width + a);

  for (let a = 0; a < outer; a += 1) {
    let start = -1;

    for (let b = 0; b <= inner; b += 1) {
      const ink = b < inner && mask.data[indexOf(a, b)] === 1;

      if (ink && start < 0) {
        start = b;
      }

      if (!ink && start >= 0) {
        if (b - start >= minRun) {
          for (let c = start; c < b; c += 1) {
            lines[indexOf(a, c)] = 1;
          }
        }

        start = -1;
      }
    }
  }
};

/** Grows the marked set by one pixel (4-neighbourhood): anti-aliased line edges are not in the ink mask. */
const growByOne = (lines: Uint8Array, width: number, height: number): void => {
  const seeds = lines.slice();

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (seeds[y * width + x] !== 1) {
        continue;
      }

      if (x > 0) {
        lines[y * width + x - 1] = 1;
      }

      if (x < width - 1) {
        lines[y * width + x + 1] = 1;
      }

      if (y > 0) {
        lines[(y - 1) * width + x] = 1;
      }

      if (y < height - 1) {
        lines[(y + 1) * width + x] = 1;
      }
    }
  }
};

/**
 * Removes grid lines from the flattened table before OCR (Spec §20): pixels of long ink runs are replaced
 * by the nearest non-line pixels across the line, so a colored weekend background stays colored (white
 * stripes would confuse per-cell binarization) and line remnants do not reach the glyphs.
 */
export const eraseGridLines = (gray: GrayImage, mask: GrayImage, options: EraseOptions): GrayImage => {
  const { width, height } = gray;
  const lines = new Uint8Array(width * height);

  markRuns(mask, lines, true, options.minHorizontalRun);
  markRuns(mask, lines, false, options.minVerticalRun);
  growByOne(lines, width, height);

  const out = createGray(width, height);

  out.data.set(gray.data);

  const sample = (x: number, y: number): number | null =>
    x >= 0 && y >= 0 && x < width && y < height && lines[y * width + x] === 0
      ? gray.data[y * width + x]!
      : null;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (lines[y * width + x] === 0) {
        continue;
      }

      const found: number[] = [];

      for (let step = 1; step <= options.searchPx && found.length === 0; step += 1) {
        for (const value of [
          sample(x, y - step),
          sample(x, y + step),
          sample(x - step, y),
          sample(x + step, y),
        ]) {
          if (value !== null) {
            found.push(value);
          }
        }
      }

      out.data[y * width + x] = found.length > 0 ? Math.max(...found) : 255;
    }
  }

  return out;
};
