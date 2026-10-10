/**
 * Generates the fictional ward roster photo of the sample trial (Spec §26.3) from SampleTryData.
 *
 *   pnpm sample:roster
 *
 * Outputs public/sample/roster.png. Korean text is rendered by librsvg through fontconfig, so run it on
 * macOS (Apple SD Gothic Neo) or a machine with a Korean font installed, then check the PNG visually.
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';

import { buildSampleRosterSvg } from './SampleRosterSvg';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUTPUT = 'public/sample/roster.png';

const target = path.join(ROOT, OUTPUT);

await mkdir(path.dirname(target), { recursive: true });

const info = await sharp(Buffer.from(buildSampleRosterSvg()))
  .png({ compressionLevel: 9, effort: 10 })
  .toFile(target);

console.log(`${OUTPUT} ${info.width}x${info.height} ${info.size}B`);
