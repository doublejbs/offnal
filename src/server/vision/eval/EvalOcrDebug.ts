import sharp from 'sharp';

import { ImageMimeType } from '@/domain/enums/ImageMimeType';
import { OcrCellInk } from '@/domain/enums/OcrCellInk';
import { OcrCodeSource } from '@/domain/enums/OcrCodeSource';
import { type OcrGeometry, type OcrRow } from '@/server/vision/ocr/OcrTableTypes';
import { encodeRawJpeg } from '@/server/vision/RawImageCodec';
import { CHANNELS, type Quad, type RawImage } from '@/server/vision/VisionGeometry';
import { type VisionImage } from '@/server/vision/VisionProvider';

/** Debug images of the AI-free reader (Spec §20), for eyes only under `.data/eval/debug/`. */

const DEBUG_JPEG_QUALITY = 85;
const TILE_HEIGHT = 56;
const TILE_WIDTH = 96;
const TILE_GAP = 4;
/** Tile border colors: decided by OCR, by glyph consensus, unresolved, blank/dash. */
const COLORS = { ocr: '#00b050', glyph: '#ff9900', unresolved: '#ff0033', blank: '#bbbbbb' } as const;

const toJpeg = async (bytes: Buffer): Promise<VisionImage> => ({
  bytes: await sharp(bytes).jpeg({ quality: DEBUG_JPEG_QUALITY }).toBuffer(),
  mime: ImageMimeType.JPEG,
});

const svgPolygon = (quad: Quad, color: string, stroke: number): string =>
  `<polygon points="${quad.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ')}" fill="none" stroke="${color}" stroke-width="${stroke}" />`;

/** The photo with the table border found without AI (green). */
export const renderOcrQuad = async (source: RawImage, quad: Quad): Promise<VisionImage> => {
  const stroke = Math.max(2, Math.round(Math.max(source.width, source.height) / 400));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${source.width}" height="${source.height}">${svgPolygon(quad, '#00b050', stroke)}</svg>`;
  const base = await encodeRawJpeg(source);

  return toJpeg(
    await sharp(base)
      .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
      .toBuffer(),
  );
};

/** Flattened table with the detected row (pink) and column (green) lines; the day-number row in blue. */
export const renderOcrGrid = async (geometry: OcrGeometry): Promise<VisionImage | null> => {
  const { warped, grid } = geometry;

  if (!warped || !grid) {
    return null;
  }

  const { width, height } = warped.raw;
  const stroke = Math.max(2, Math.round(width / 800));
  const header =
    geometry.headerRow === null
      ? ''
      : `<rect x="0" y="${grid.rowLines[geometry.headerRow]}" width="${width}" height="${
          grid.rowLines[geometry.headerRow + 1]! - grid.rowLines[geometry.headerRow]!
        }" fill="#0066ff" fill-opacity="0.15" />`;
  const rows = grid.rowLines
    .map((y) => `<line x1="0" x2="${width}" y1="${y}" y2="${y}" stroke="#ff0066" stroke-width="${stroke}" />`)
    .join('');
  const columns = grid.columnLines
    .map(
      (x) => `<line x1="${x}" x2="${x}" y1="0" y2="${height}" stroke="#00b050" stroke-width="${stroke}" />`,
    )
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${header}${rows}${columns}</svg>`;
  const base = await encodeRawJpeg(warped.raw);

  return toJpeg(
    await sharp(base)
      .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
      .toBuffer(),
  );
};

const tileColor = (cell: OcrRow['cells'][number]): string => {
  if (cell.ink !== OcrCellInk.TEXT) {
    return COLORS.blank;
  }

  if (cell.code === null) {
    return COLORS.unresolved;
  }

  return cell.source === OcrCodeSource.GLYPH ? COLORS.glyph : COLORS.ocr;
};

const cropRow = (raw: RawImage, row: OcrRow): Buffer => {
  const top = Math.max(0, Math.floor(row.rect.top));
  const bottom = Math.min(raw.height, Math.ceil(row.rect.bottom));

  return raw.data.subarray(top * raw.width * CHANNELS, bottom * raw.width * CHANNELS);
};

/**
 * One person row: the flattened row strip on top, then every day's cleaned glyph crop as sent to OCR,
 * framed green (OCR), orange (glyph consensus), red (unresolved) or gray (blank/dash), day 1 → N.
 */
export const renderOcrRow = async (geometry: OcrGeometry, row: OcrRow): Promise<VisionImage | null> => {
  const { warped } = geometry;

  if (!warped) {
    return null;
  }

  const stripHeight = Math.max(1, Math.ceil(row.rect.bottom) - Math.max(0, Math.floor(row.rect.top)));
  const width = Math.max(warped.raw.width, row.cells.length * (TILE_WIDTH + TILE_GAP));
  const strip = await sharp(cropRow(warped.raw, row), {
    raw: { width: warped.raw.width, height: stripHeight, channels: CHANNELS },
  })
    .png()
    .toBuffer();
  const tiles = await Promise.all(
    row.cells.map(async (cell, index) => {
      const inner = cell.glyphPng
        ? await sharp(cell.glyphPng)
            .resize({ width: TILE_WIDTH - 8, height: TILE_HEIGHT - 8, fit: 'contain', background: '#ffffff' })
            .png()
            .toBuffer()
        : await sharp({
            create: { width: TILE_WIDTH - 8, height: TILE_HEIGHT - 8, channels: 3, background: '#ffffff' },
          })
            .png()
            .toBuffer();
      const tile = await sharp(inner)
        .extend({ top: 4, bottom: 4, left: 4, right: 4, background: tileColor(cell) })
        .png()
        .toBuffer();

      return { input: tile, left: index * (TILE_WIDTH + TILE_GAP), top: stripHeight + TILE_GAP };
    }),
  );
  const canvas = await sharp({
    create: { width, height: stripHeight + TILE_GAP + TILE_HEIGHT, channels: 3, background: '#ffffff' },
  })
    .composite([{ input: strip, left: 0, top: 0 }, ...tiles])
    .png()
    .toBuffer();

  return toJpeg(canvas);
};
