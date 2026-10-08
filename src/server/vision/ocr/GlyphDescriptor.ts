import { type GrayImage } from '@/server/vision/ocr/GrayRaster';

/** Normalized shape of a cell's glyphs: ink density on a fixed grid plus the aspect ratio. */
export type GlyphDescriptor = { densities: Float32Array; aspect: number };

/** Glyphs are resampled onto GRID × GRID cells (fill, aspect kept separately). */
export const DESCRIPTOR_GRID = 16;

/** Weight of the log aspect-ratio difference against the mean density difference. */
const ASPECT_WEIGHT = 0.25;
const PAPER = 255;

/**
 * Area-averaged ink density of glyph shades (0 = ink, 255 = paper; gray keeps detail of tiny glyphs) on a
 * GRID × GRID raster.
 */
export const describeGlyphs = (glyphs: GrayImage): GlyphDescriptor => {
  const densities = new Float32Array(DESCRIPTOR_GRID * DESCRIPTOR_GRID);
  const counts = new Float32Array(DESCRIPTOR_GRID * DESCRIPTOR_GRID);

  for (let y = 0; y < glyphs.height; y += 1) {
    const gridY = Math.min(DESCRIPTOR_GRID - 1, Math.floor((y * DESCRIPTOR_GRID) / glyphs.height));

    for (let x = 0; x < glyphs.width; x += 1) {
      const gridX = Math.min(DESCRIPTOR_GRID - 1, Math.floor((x * DESCRIPTOR_GRID) / glyphs.width));
      const slot = gridY * DESCRIPTOR_GRID + gridX;

      densities[slot]! += 1 - glyphs.data[y * glyphs.width + x]! / PAPER;
      counts[slot]! += 1;
    }
  }

  densities.forEach((value, slot) => {
    densities[slot] = counts[slot]! > 0 ? value / counts[slot]! : 0;
  });

  return { densities, aspect: glyphs.width / Math.max(1, glyphs.height) };
};

/** Mean absolute density difference + weighted |log aspect ratio| difference (0 = identical). */
export const compareGlyphs = (a: GlyphDescriptor, b: GlyphDescriptor): number => {
  let sum = 0;

  for (let slot = 0; slot < a.densities.length; slot += 1) {
    sum += Math.abs(a.densities[slot]! - b.densities[slot]!);
  }

  return sum / a.densities.length + ASPECT_WEIGHT * Math.abs(Math.log(a.aspect / b.aspect));
};
