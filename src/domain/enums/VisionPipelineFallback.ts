/** Why the pipeline used a simpler input than its mode asked for (never a failure by itself). */
export enum VisionPipelineFallback {
  /** Pass 1 returned no grid corners. */
  NO_GRID = 'no-grid',
  /** Corners were not a convex quad, too small, or the warp failed. */
  INVALID_GRID = 'invalid-grid',
  /** locateRow returned null (name not found). */
  ROW_NOT_FOUND = 'row-not-found',
  /** locateRow returned an implausible band. */
  INVALID_ROW = 'invalid-row',
  /** locateRow call failed or the strip could not be built. */
  LOCATE_FAILED = 'locate-failed',
  /** The strip reading was not verifiably the target row (name/ordinal mismatch or not in the strip). */
  STRIP_ROW_MISMATCH = 'strip-row-mismatch',
}
