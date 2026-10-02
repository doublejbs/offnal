import { OcrCellInk } from '@/domain/enums/OcrCellInk';
import { type OcrLanguage } from '@/domain/enums/OcrLanguage';
import { type OcrPageSegMode } from '@/domain/enums/OcrPageSegMode';
import { type CleanCell, cleanCell, type CleanCellOptions } from '@/server/vision/ocr/CellCleaner';
import { renderGlyphsPng } from '@/server/vision/ocr/GlyphImage';
import { type GrayImage } from '@/server/vision/ocr/GrayRaster';
import { type OcrProvider, type OcrText } from '@/server/vision/ocr/OcrProvider';
import { type PixelRect } from '@/server/vision/VisionGeometry';

export type OcrPass = {
  languages: OcrLanguage[];
  whitelist: string | null;
  pageSegMode: OcrPageSegMode;
};

/** A cleaned cell plus its rendered glyph PNG (text cells only), reusable across OCR passes. */
export type PreparedCell = { clean: CleanCell; png: Buffer | null };

export const prepareCell = async (
  gray: GrayImage,
  rect: PixelRect,
  options: CleanCellOptions,
): Promise<PreparedCell> => {
  const clean = cleanCell(gray, rect, options);
  const png = clean.ink === OcrCellInk.TEXT && clean.shades ? await renderGlyphsPng(clean.shades) : null;

  return { clean, png };
};

/** OCR of a prepared cell; blank/dash cells are not sent to the engine (empty text, no confidence). */
export const readPreparedCell = async (
  ocr: OcrProvider,
  cell: PreparedCell,
  pass: OcrPass,
): Promise<OcrText | null> => (cell.png ? ocr.recognize({ image: cell.png, ...pass }) : null);

/** Grid cell rectangle (row r spans rowLines[r]…rowLines[r+1], same for columns). */
export const getCellRect = (
  rowLines: number[],
  columnLines: number[],
  row: number,
  column: number,
): PixelRect => ({
  left: columnLines[column]!,
  right: columnLines[column + 1]!,
  top: rowLines[row]!,
  bottom: rowLines[row + 1]!,
});
