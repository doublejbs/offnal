import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';

import { ImageMimeType } from '@/domain/enums/ImageMimeType';
import { type GridCorners } from '@/domain/types/GridCorners';
import { toPixelQuad } from '@/server/vision/PerspectiveWarp';
import { type Quad } from '@/server/vision/VisionGeometry';
import { type EvalDebugSink } from '@/server/vision/eval/EvalTypes';
import { type VisionImage } from '@/server/vision/VisionProvider';

/** Debug overlays are for eyes only; a lighter quality keeps the files small. */
const DEBUG_JPEG_QUALITY = 85;
/** Corner marker radius in stroke widths. */
const MARKER_RADIUS_STROKES = 3;

const drawQuad = (quad: Quad, color: string, stroke: number): string => {
  const points = quad.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
  const markers = quad
    .map(
      (point) =>
        `<circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="${stroke * MARKER_RADIUS_STROKES}" />`,
    )
    .join('');

  return `<polygon points="${points}" fill="none" stroke="${color}" stroke-width="${stroke}" /><g fill="${color}">${markers}</g>`;
};

/**
 * The provider copy with the pass-1 grid quad (pink) and the tilt-refined quad actually used (green)
 * drawn on it, to judge the corners by eye.
 */
export const renderGridOverlay = async (
  image: VisionImage,
  grid: GridCorners,
  refined: Quad | null,
): Promise<VisionImage> => {
  const { width = 0, height = 0 } = await sharp(image.bytes).metadata();
  const stroke = Math.max(2, Math.round(Math.max(width, height) / 500));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
${drawQuad(toPixelQuad(grid, width, height), '#ff0066', stroke)}
${refined ? drawQuad(refined, '#00b050', stroke) : ''}</svg>`;
  const bytes = await sharp(image.bytes)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .jpeg({ quality: DEBUG_JPEG_QUALITY })
    .toBuffer();

  return { bytes, mime: ImageMimeType.JPEG };
};

const toSafeFileName = (value: string): string => value.replace(/[^a-zA-Z0-9._-]+/gu, '_');

/** Writes one run's debug images under `<debugRoot>/<model>/<sample>-r<repeat>/`. */
export const createDebugSink = (
  debugRoot: string,
  model: string,
  sampleId: string,
  repeat: number,
): EvalDebugSink => {
  const dir = path.join(debugRoot, toSafeFileName(model), `${toSafeFileName(sampleId)}-r${repeat}`);

  return async (fileName, image) => {
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, toSafeFileName(fileName)), image.bytes);
  };
};
