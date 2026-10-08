import { buildInkMask, type GrayImage } from '@/server/vision/ocr/GrayRaster';
import {
  findLinePeaks,
  type LinePeak,
  profileHorizontalRuns,
  profileVerticalRuns,
  regularizeLines,
  sumWindow,
} from '@/server/vision/ocr/LineProfile';
import { type WarpedTable } from '@/server/vision/ocr/TableWarp';
import { type PixelRect } from '@/server/vision/VisionGeometry';

/** Row and column boundaries of the flattened table (pixel positions, top→bottom / left→right). */
export type TableGrid = {
  rowLines: number[];
  columnLines: number[];
  /** Line ink mask of the flattened image (1 = ink), reused to erase lines from cell crops. */
  mask: GrayImage;
};

/** Search slack around the detected border, as a share of the table size. */
const BORDER_SLACK_SHARE = 0.03;
/** A line must cover this share of the table extent (header lines ~90% pass, an approval box ~35% does not). */
const LINE_COVER_SHARE = 0.5;
/** Runs shorter than this share of the table width/height are text, not lines. */
const MIN_RUN_SHARE = 1 / 30;
const MAX_GAP_PX = 3;
/** Peaks closer than this share of the table extent are one (thick) line. */
const ROW_MERGE_SHARE = 1 / 70;
const COLUMN_MERGE_SHARE = 1 / 140;
/** Rows before this index (day numbers + weekdays) are not equalized with the person rows. */
const HEADER_ROW_LINES = 2;
/** The first column (names) is wider than the day columns and is not equalized. */
const NAME_COLUMN_LINES = 1;
/** Profiles are summed over this share of the table extent (lines drifting by a few pixels). */
const DRIFT_WINDOW_SHARE = 1 / 150;
const MASK_DARK_SHARE = 0.8;
const MASK_MAX_CHROMA = 80;

/** Minimum line count of a usable grid: name column + 28 days needs 30 vertical lines. */
export const MIN_COLUMN_LINES = 30;
export const MIN_ROW_LINES = 4;

const expandRect = (rect: PixelRect, width: number, height: number): PixelRect => {
  const slackX = (rect.right - rect.left) * BORDER_SLACK_SHARE;
  const slackY = (rect.bottom - rect.top) * BORDER_SLACK_SHARE;

  return {
    left: Math.max(0, Math.floor(rect.left - slackX)),
    top: Math.max(0, Math.floor(rect.top - slackY)),
    right: Math.min(width, Math.ceil(rect.right + slackX)),
    bottom: Math.min(height, Math.ceil(rect.bottom + slackY)),
  };
};

const toPositions = (peaks: LinePeak[], offset: number): number[] =>
  peaks.map((peak) => peak.position + offset);

/**
 * Grid lines of the flattened table from projection profiles of long dark runs (Spec §21): colorful
 * weekend columns are excluded from the ink mask, thick separators merge into one line, and the evenly
 * spaced day columns / person rows get missing lines re-inserted and spurious ones dropped.
 */
export const detectGrid = (warped: WarpedTable): TableGrid | null => {
  const { gray } = warped.pixels;
  const tableWidth = warped.table.right - warped.table.left;
  const tableHeight = warped.table.bottom - warped.table.top;
  const radius = Math.max(6, Math.round(Math.min(tableWidth, tableHeight) / 40));
  const mask = buildInkMask(warped.pixels, {
    radius,
    darkShare: MASK_DARK_SHARE,
    maxChroma: MASK_MAX_CHROMA,
  });
  const area = expandRect(warped.table, gray.width, gray.height);
  const horizontal = profileHorizontalRuns(mask, area, {
    minRun: Math.round(tableWidth * MIN_RUN_SHARE),
    maxGap: MAX_GAP_PX,
  });
  const vertical = profileVerticalRuns(mask, area, {
    minRun: Math.round(tableHeight * MIN_RUN_SHARE),
    maxGap: MAX_GAP_PX,
  });
  const rowPeaks = findLinePeaks(
    sumWindow(horizontal, Math.max(3, Math.round(tableHeight * DRIFT_WINDOW_SHARE))),
    tableWidth * LINE_COVER_SHARE,
    tableHeight * ROW_MERGE_SHARE,
  );
  const columnPeaks = findLinePeaks(
    sumWindow(vertical, Math.max(3, Math.round(tableWidth * DRIFT_WINDOW_SHARE))),
    tableHeight * LINE_COVER_SHARE,
    tableWidth * COLUMN_MERGE_SHARE,
  );
  const rowLines = toPositions(regularizeLines(rowPeaks, HEADER_ROW_LINES), area.top);
  const columnLines = toPositions(regularizeLines(columnPeaks, NAME_COLUMN_LINES), area.left);

  if (rowLines.length < MIN_ROW_LINES || columnLines.length < MIN_COLUMN_LINES) {
    return null;
  }

  return { rowLines, columnLines, mask };
};
