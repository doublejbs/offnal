import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { ImageMimeType } from '@/domain/enums/ImageMimeType';
import { type RawImage } from '@/server/vision/PerspectiveWarp';
import { buildRowStrip, computeStripPlan, STRIP_SEPARATOR_PX } from '@/server/vision/RowStrip';

// Warped image 1200×1000 whose day grid spans y 40…970 (height 930).
const WARP = { width: 1200, height: 1000, dayGrid: { left: 200, top: 40, right: 1180, bottom: 970 } };

describe('computeStripPlan', () => {
  it('crops the date header band and the target row with 25% margins', () => {
    // Row 500…540 px (40 px high → 10 px margin); header bottom 110 px + 10% of the row height.
    const plan = computeStripPlan(WARP, { top: 500, bottom: 540, headerBottom: 110 });

    expect(plan).toEqual({
      bands: [
        // Header starts 2% of the grid height above the grid top: 40 - 18.6 → 21.
        { top: 21, bottom: 114 },
        { top: 490, bottom: 550 },
      ],
    });
  });

  it('assumes a two-row header when the model gave no plausible header bottom', () => {
    expect(computeStripPlan(WARP, { top: 500, bottom: 540, headerBottom: null })?.bands[0]).toEqual({
      top: 21,
      bottom: 124,
    });
    // Header bottom below the row itself is ignored the same way.
    expect(computeStripPlan(WARP, { top: 500, bottom: 540, headerBottom: 900 })?.bands[0]).toEqual({
      top: 21,
      bottom: 124,
    });
  });

  it('merges header and row into one band when they touch', () => {
    expect(computeStripPlan(WARP, { top: 120, bottom: 160, headerBottom: 110 })).toEqual({
      bands: [{ top: 21, bottom: 170 }],
    });
  });

  it('clamps the margins to the image', () => {
    const plan = computeStripPlan(WARP, { top: 950, bottom: 995, headerBottom: 110 });

    expect(plan?.bands[1]).toEqual({ top: 939, bottom: 1000 });
  });

  it('rejects rows outside the day grid', () => {
    const shortGrid = { ...WARP, dayGrid: { ...WARP.dayGrid, bottom: 800 } };

    expect(computeStripPlan(shortGrid, { top: 900, bottom: 940, headerBottom: null })).toBeNull();
    expect(computeStripPlan(shortGrid, { top: 760, bottom: 800, headerBottom: null })).not.toBeNull();
  });

  it('rejects implausible bands', () => {
    for (const band of [
      { top: 540, bottom: 500, headerBottom: null },
      { top: 500, bottom: 500, headerBottom: null },
      // Taller than a third of the grid: not a single row.
      { top: 200, bottom: 600, headerBottom: null },
      { top: Number.NaN, bottom: 540, headerBottom: null },
      { top: -5, bottom: 30, headerBottom: null },
      { top: 500, bottom: 1200, headerBottom: null },
    ]) {
      expect(computeStripPlan(WARP, band)).toBeNull();
    }
  });
});

const solidRaw = (width: number, height: number): RawImage => {
  const data = Buffer.alloc(width * height * 3);

  for (let y = 0; y < height; y += 1) {
    data.fill(y % 256, y * width * 3, (y + 1) * width * 3);
  }

  return { data, width, height };
};

describe('buildRowStrip', () => {
  it('stacks the bands with a separator and upscales 2× within the edge limit', async () => {
    const strip = await buildRowStrip(solidRaw(1200, 1000), {
      bands: [
        { top: 21, bottom: 114 },
        { top: 490, bottom: 550 },
      ],
    });
    const metadata = await sharp(strip.bytes).metadata();

    expect(strip.mime).toBe(ImageMimeType.JPEG);
    expect([metadata.width, metadata.height]).toEqual([2400, (93 + STRIP_SEPARATOR_PX + 60) * 2]);
  });

  it('upscales less than 2× when the warped image is already wide', async () => {
    const strip = await buildRowStrip(solidRaw(2000, 400), { bands: [{ top: 0, bottom: 100 }] });
    const metadata = await sharp(strip.bytes).metadata();

    expect(metadata.width).toBe(2576);
    expect(metadata.height).toBe(Math.round(100 * (2576 / 2000)));
  });
});
