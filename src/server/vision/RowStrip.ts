import sharp from 'sharp';

import { ImageMimeType } from '@/domain/enums/ImageMimeType';
import { type PixelRect, type RawImage } from '@/server/vision/PerspectiveWarp';
import { VISION_MAX_EDGE_PX } from '@/server/vision/VisionImagePreparer';
import { type RowBand, type VisionImage } from '@/server/vision/VisionProvider';

export type PixelBand = { top: number; bottom: number };

/** Horizontal bands of the warped image to stack: [header, row], or one band when they touch. */
export type StripPlan = { bands: PixelBand[] };

type WarpGeometry = { width: number; height: number; dayGrid: PixelRect };

/**
 * Context kept above and below the located row, as a share of its height: about one neighbouring row on
 * each side, so a one-row localization error still leaves the target row (picked by its name) in the strip.
 */
export const ROW_MARGIN_RATIO = 1.25;
/** Gray rows between the header band and the row band (before upscaling). */
export const STRIP_SEPARATOR_PX = 6;

const STRIP_SCALE = 2;
const JPEG_QUALITY = 90;
const NORMALIZED_MAX = 1000;
const SEPARATOR_GRAY = 128;
/** A single person row is never taller than this share of the grid. */
const MAX_ROW_SHARE = 0.34;
const MIN_ROW_PX = 4;
/** Tolerance for rows outside the model's grid corners (same order as the warp margins). */
const GRID_TOLERANCE = 0.06;
/** Header band starts this share of the grid height above the grid top (catches the top border). */
const HEADER_LEAD = 0.02;
/** A date header (day numbers + weekdays) is never taller than this share of the grid. */
const MAX_HEADER_SHARE = 0.3;
/** Assumed header height in rows when the model gives none. */
const DEFAULT_HEADER_ROWS = 2;
const HEADER_PAD_RATIO = 0.1;

const isNormalized = (value: number): boolean =>
  Number.isFinite(value) && value >= 0 && value <= NORMALIZED_MAX;

/**
 * Strip crop math (pure): validates the model's row band (0–1000 of the warped image height) against the
 * day grid and returns the pixel bands to stack, or null when the band is implausible.
 */
export const computeStripPlan = (warp: WarpGeometry, band: RowBand): StripPlan | null => {
  if (!isNormalized(band.top) || !isNormalized(band.bottom) || band.bottom <= band.top) {
    return null;
  }

  const toPx = (value: number) => (value / NORMALIZED_MAX) * warp.height;
  const { dayGrid } = warp;
  const gridHeight = dayGrid.bottom - dayGrid.top;
  const rowTop = toPx(band.top);
  const rowBottom = toPx(band.bottom);
  const rowHeight = rowBottom - rowTop;
  const tolerance = gridHeight * GRID_TOLERANCE;

  if (
    rowHeight < MIN_ROW_PX ||
    rowHeight > gridHeight * MAX_ROW_SHARE ||
    rowTop < dayGrid.top - tolerance ||
    rowBottom > dayGrid.bottom + tolerance
  ) {
    return null;
  }

  const headerTop = Math.max(0, Math.round(dayGrid.top - gridHeight * HEADER_LEAD));
  const modelHeaderBottom =
    band.headerBottom !== null && isNormalized(band.headerBottom) ? toPx(band.headerBottom) : null;
  const plausibleHeaderBottom =
    modelHeaderBottom !== null &&
    modelHeaderBottom > dayGrid.top &&
    modelHeaderBottom <= rowTop + rowHeight / 2 &&
    modelHeaderBottom - dayGrid.top <= gridHeight * MAX_HEADER_SHARE
      ? modelHeaderBottom
      : dayGrid.top + rowHeight * DEFAULT_HEADER_ROWS;
  const headerBottom = Math.round(plausibleHeaderBottom + rowHeight * HEADER_PAD_RATIO);
  const margin = rowHeight * ROW_MARGIN_RATIO;
  const rowCropTop = Math.max(0, Math.round(rowTop - margin));
  const rowCropBottom = Math.min(warp.height, Math.round(rowBottom + margin));

  if (headerBottom >= rowCropTop) {
    return { bands: [{ top: headerTop, bottom: rowCropBottom }] };
  }

  return {
    bands: [
      { top: headerTop, bottom: headerBottom },
      { top: rowCropTop, bottom: rowCropBottom },
    ],
  };
};

/** Stacks full-width bands of the warped raw image (gray separator between them) and upscales ≤ 2×. */
export const buildRowStrip = async (
  raw: RawImage,
  plan: StripPlan,
  maxEdge: number = VISION_MAX_EDGE_PX,
): Promise<VisionImage> => {
  const rowBytes = raw.width * 3;
  const separator = Buffer.alloc(STRIP_SEPARATOR_PX * rowBytes, SEPARATOR_GRAY);
  const parts = plan.bands.flatMap((band, index) => {
    const slice = raw.data.subarray(band.top * rowBytes, band.bottom * rowBytes);

    return index === 0 ? [slice] : [separator, slice];
  });
  const stacked = Buffer.concat(parts);
  const height = stacked.length / rowBytes;
  const scale = Math.min(STRIP_SCALE, maxEdge / raw.width, maxEdge / height);
  const bytes = await sharp(stacked, { raw: { width: raw.width, height, channels: 3 } })
    .resize({
      width: Math.round(raw.width * scale),
      height: Math.round(height * scale),
      kernel: 'lanczos3',
      fit: 'fill',
    })
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer();

  return { bytes, mime: ImageMimeType.JPEG };
};
