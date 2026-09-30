import { type Homography, type PixelPoint, type Quad } from '@/server/vision/VisionGeometry';

/** Pivot below this share of the column's largest remaining entry = singular system. */
const PIVOT_EPSILON = 1e-10;
const HOMOGRAPHY_UNKNOWNS = 8;

/**
 * Solves the homography mapping each `from` corner onto the matching `to` corner: the 8×8 linear system
 * of the standard DLT form with h[8] = 1, by Gaussian elimination with partial pivoting.
 * Returns null when the system is singular (collinear/degenerate points).
 */
export const solveHomography = (from: Quad, to: Quad): Homography | null => {
  const rows: number[][] = [];
  const size = HOMOGRAPHY_UNKNOWNS;

  from.forEach((source, index) => {
    const target = to[index]!;

    rows.push([source.x, source.y, 1, 0, 0, 0, -target.x * source.x, -target.x * source.y, target.x]);
    rows.push([0, 0, 0, source.x, source.y, 1, -target.y * source.x, -target.y * source.y, target.y]);
  });

  for (let column = 0; column < size; column += 1) {
    let pivotRow = column;
    // Relative threshold over the rows still being eliminated (earlier rows are already reduced).
    let scale = 1;

    for (let row = column; row < size; row += 1) {
      const value = Math.abs(rows[row]![column]!);

      scale = Math.max(scale, value);

      if (value > Math.abs(rows[pivotRow]![column]!)) {
        pivotRow = row;
      }
    }

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
