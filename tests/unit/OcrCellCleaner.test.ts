import { describe, expect, it } from 'vitest';

import { OcrCellInk } from '@/domain/enums/OcrCellInk';
import { cleanCell, type CleanCellOptions } from '@/server/vision/ocr/CellCleaner';
import { createGray, type GrayImage } from '@/server/vision/ocr/GrayRaster';

const WIDTH = 60;
const HEIGHT = 40;
const PAPER = 230;
const RECT = { left: 0, top: 0, right: WIDTH, bottom: HEIGHT };
const OPTIONS: CleanCellOptions = { inset: 0.08, dropEnclosing: true };

/** One synthetic cell: paper everywhere, `value` in each [left, top, right, bottom) box. */
const paint = (value: number, boxes: [number, number, number, number][]): GrayImage => {
  const image = createGray(WIDTH, HEIGHT);

  image.data.fill(PAPER);

  for (const [left, top, right, bottom] of boxes) {
    for (let y = top; y < bottom; y += 1) {
      for (let x = left; x < right; x += 1) {
        image.data[y * WIDTH + x] = value;
      }
    }
  }

  return image;
};

/** A glyph-tall "T" (bar + stem), 18 px of a 40 px cell. */
const LETTER: [number, number, number, number][] = [
  [22, 11, 38, 14],
  [28, 14, 32, 29],
];

describe('cell cleaning: blank / dash / text / ambiguous', () => {
  it('reads plain paper and faint specks as blank', () => {
    expect(cleanCell(paint(PAPER, []), RECT, OPTIONS).ink).toBe(OcrCellInk.BLANK);

    const specks = paint(195, [
      [15, 10, 17, 12],
      [40, 25, 42, 27],
    ]);

    expect(cleanCell(specks, RECT, OPTIONS).ink).toBe(OcrCellInk.BLANK);
  });

  it('reads one short dark horizontal stroke as a dash', () => {
    const cell = cleanCell(paint(30, [[20, 19, 40, 22]]), RECT, OPTIONS);

    expect(cell.ink).toBe(OcrCellInk.DASH);
  });

  it('reads dark glyphs as text with an OCR crop', () => {
    const cell = cleanCell(paint(30, LETTER), RECT, OPTIONS);

    expect(cell.ink).toBe(OcrCellInk.TEXT);
    expect(cell.shades).not.toBeNull();
  });

  it('marks faint glyph-tall ink as ambiguous and never sends it to OCR', () => {
    const cell = cleanCell(paint(195, LETTER), RECT, OPTIONS);

    expect(cell.ink).toBe(OcrCellInk.AMBIGUOUS);
    expect(cell.shades).toBeNull();
    expect(cell.glyphs).toBeNull();
  });
});
