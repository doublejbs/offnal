import sharp from 'sharp';

import { type GrayImage } from '@/server/vision/ocr/GrayRaster';

/** Tesseract reads best with glyphs about this tall (cap height in pixels). */
export const OCR_GLYPH_HEIGHT_PX = 44;

/** White border around the glyphs (Tesseract needs some background around text). */
const PADDING_PX = 16;
const WHITE = 255;
const WHITE_BACKGROUND = { r: WHITE, g: WHITE, b: WHITE };

/** PNG of anti-aliased glyph shades (0 = ink, 255 = paper), scaled so the glyphs are `glyphHeight` tall. */
export const renderGlyphsPng = async (
  shades: GrayImage,
  glyphHeight = OCR_GLYPH_HEIGHT_PX,
): Promise<Buffer> => {
  const scale = glyphHeight / shades.height;

  return sharp(Buffer.from(shades.data), { raw: { width: shades.width, height: shades.height, channels: 1 } })
    .resize({
      width: Math.max(1, Math.round(shades.width * scale)),
      height: glyphHeight,
      fit: 'fill',
      kernel: 'lanczos3',
    })
    .extend({
      top: PADDING_PX,
      bottom: PADDING_PX,
      left: PADDING_PX,
      right: PADDING_PX,
      background: WHITE_BACKGROUND,
    })
    .png()
    .toBuffer();
};

/** Grayscale PNG of a raster region (title/legend text blocks), upscaled ≤ `maxScale` toward `targetHeight`. */
export const renderGrayPng = async (gray: GrayImage, scale = 1): Promise<Buffer> =>
  sharp(Buffer.from(gray.data), { raw: { width: gray.width, height: gray.height, channels: 1 } })
    .resize({
      width: Math.max(1, Math.round(gray.width * scale)),
      height: Math.max(1, Math.round(gray.height * scale)),
      fit: 'fill',
      kernel: 'cubic',
    })
    .png()
    .toBuffer();
