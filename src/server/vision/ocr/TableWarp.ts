import { solveHomography } from '@/server/vision/Homography';
import { warpRaw } from '@/server/vision/PerspectiveWarp';
import { type GrayChroma, toGrayChroma } from '@/server/vision/ocr/GrayRaster';
import { measureDistance, type PixelRect, type Quad, type RawImage } from '@/server/vision/VisionGeometry';

/**
 * Area kept around the table, as shares of its width/height: the title (year/month) sits above it and the
 * legend below it. The sheet is planar, so the homography extends past the table border.
 */
export const OCR_WARP_MARGINS = { left: 0.02, right: 0.02, top: 0.2, bottom: 0.35 } as const;
/** Long edge cap of the flattened sheet (keeps 4000px photos near native resolution). */
export const OCR_WARP_MAX_EDGE_PX = 4200;

export type WarpedTable = {
  raw: RawImage;
  pixels: GrayChroma;
  /** Table border in the flattened image. */
  table: PixelRect;
};

/** Flattens the detected table (plus title/legend margins) at about the source resolution. */
export const warpTable = (source: RawImage, quad: Quad): WarpedTable | null => {
  const [topLeft, topRight, bottomRight, bottomLeft] = quad;
  const tableWidth = (measureDistance(topLeft, topRight) + measureDistance(bottomLeft, bottomRight)) / 2;
  const tableHeight = (measureDistance(topLeft, bottomLeft) + measureDistance(topRight, bottomRight)) / 2;
  const fullWidth = tableWidth * (1 + OCR_WARP_MARGINS.left + OCR_WARP_MARGINS.right);
  const fullHeight = tableHeight * (1 + OCR_WARP_MARGINS.top + OCR_WARP_MARGINS.bottom);
  const scale = Math.min(1, OCR_WARP_MAX_EDGE_PX / Math.max(fullWidth, fullHeight));
  const width = Math.round(fullWidth * scale);
  const height = Math.round(fullHeight * scale);
  const left = tableWidth * OCR_WARP_MARGINS.left * scale;
  const top = tableHeight * OCR_WARP_MARGINS.top * scale;
  const table = { left, top, right: left + tableWidth * scale, bottom: top + tableHeight * scale };
  const outputToSource = solveHomography(
    [
      { x: table.left, y: table.top },
      { x: table.right, y: table.top },
      { x: table.right, y: table.bottom },
      { x: table.left, y: table.bottom },
    ],
    quad,
  );

  if (!outputToSource || width < 1 || height < 1) {
    return null;
  }

  const raw = warpRaw(source, width, height, outputToSource);

  return { raw, pixels: toGrayChroma(raw), table };
};
