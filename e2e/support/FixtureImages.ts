import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { type TestInfo } from '@playwright/test';
import sharp from 'sharp';

/** Mock vision treats anything at least 300px wide as a table; narrower images fail with NO_TABLE. */
export const TABLE_IMAGE_SIZE = { width: 1200, height: 900 };
export const NARROW_IMAGE_SIZE = { width: 250, height: 900 };

const GRID_STEP = 60;

/** A plain grid drawing (no names or codes): the mock provider only looks at the width. */
const buildGridSvg = (width: number, height: number): Buffer => {
  const lines: string[] = [];

  for (let x = 0; x <= width; x += GRID_STEP) {
    lines.push(`<line x1="${x}" y1="0" x2="${x}" y2="${height}" stroke="#94a3b8" stroke-width="2"/>`);
  }

  for (let y = 0; y <= height; y += GRID_STEP) {
    lines.push(`<line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="#94a3b8" stroke-width="2"/>`);
  }

  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${lines.join('')}</svg>`,
  );
};

export const createPngBuffer = async (width: number, height: number): Promise<Buffer> =>
  sharp({ create: { width, height, channels: 3, background: '#ffffff' } })
    .composite([{ input: buildGridSvg(width, height) }])
    .png()
    .toBuffer();

/** Writes a generated PNG into the test's own output directory and returns its path. */
export const writePngFixture = async (
  testInfo: TestInfo,
  name: string,
  size: { width: number; height: number },
): Promise<string> => {
  const filePath = testInfo.outputPath(name);

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, await createPngBuffer(size.width, size.height));

  return filePath;
};
