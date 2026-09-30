/** Point in image-normalized coordinates: 0–1000 of width (x) and height (y), origin top-left. */
export type NormalizedPoint = {
  x: number;
  y: number;
};

/**
 * Four corners of the day-cell grid (day-1 column left border … last day column right border,
 * top of the date header … bottom of the last person row). Temporary, like the rest of pass 1.
 */
export type GridCorners = {
  topLeft: NormalizedPoint;
  topRight: NormalizedPoint;
  bottomRight: NormalizedPoint;
  bottomLeft: NormalizedPoint;
};
