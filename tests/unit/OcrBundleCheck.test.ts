import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { checkOcrBundle, listRequiredOcrFiles } from '@/server/vision/ocr/OcrBundleCheck';

const ROOT = path.resolve(import.meta.dirname, '..', '..');

describe('OCR bundle check (Spec §22-11)', () => {
  const required = listRequiredOcrFiles(ROOT);

  it('requires the worker script, every package it requires by name, the WASM cores and the language data', () => {
    const relative = required.map((file) => path.relative(ROOT, file).split(path.sep).join('/'));

    expect(relative).toEqual(
      expect.arrayContaining([
        'node_modules/tesseract.js/src/worker-script/node/index.js',
        'node_modules/tesseract.js/src/worker-script/index.js',
        'node_modules/tesseract.js-core/tesseract-core-simd-lstm.js',
        'node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm',
        'node_modules/tesseract.js-core/tesseract-core-relaxedsimd.wasm',
        'node_modules/tesseract.js-core/tesseract-core.wasm',
        'node_modules/tesseract.js-core/package.json',
        'node_modules/wasm-feature-detect/package.json',
        'node_modules/@tesseract.js-data/kor/4.0.0_best_int/kor.traineddata.gz',
        'node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz',
      ]),
    );

    for (const name of ['wasm-feature-detect', 'regenerator-runtime', 'is-url', 'bmp-js']) {
      expect(
        relative.some((file) => file.startsWith(`node_modules/${name}/`)),
        name,
      ).toBe(true);
    }

    // Only reached when the runtime has no global fetch (Node 22 has one): not shipped.
    expect(relative.some((file) => file.includes('node-fetch'))).toBe(false);
  });

  it('passes with every required file at a plain path and an extract trace without tesseract', () => {
    expect(
      checkOcrBundle({ root: ROOT, ocrTrace: required, extractTrace: [path.join(ROOT, 'package.json')] }),
    ).toEqual([]);
  });

  it('reports a missing file and tesseract in the extract trace', () => {
    const missing = required.filter((file) => !file.endsWith('kor.traineddata.gz'));
    const problems = checkOcrBundle({
      root: ROOT,
      ocrTrace: missing,
      extractTrace: [path.join(ROOT, 'node_modules/tesseract.js/src/index.js')],
    });

    expect(problems).toEqual([
      expect.stringContaining('kor.traineddata.gz'),
      expect.stringContaining('extract'),
    ]);
  });

  describe('symlinked directories', () => {
    let tempRoot = '';

    beforeAll(async () => {
      tempRoot = await mkdtemp(path.join(tmpdir(), 'offnal-bundle-'));
      await mkdir(path.join(tempRoot, 'real'));
      await writeFile(path.join(tempRoot, 'real', 'file.js'), '');
      await symlink(path.join(tempRoot, 'real'), path.join(tempRoot, 'linked'), 'dir');
    });

    afterAll(async () => {
      await rm(tempRoot, { recursive: true, force: true });
    });

    it('reports a traced file under a symlinked directory', () => {
      const problems = checkOcrBundle({
        root: ROOT,
        ocrTrace: [...required, path.join(tempRoot, 'linked', 'file.js')],
        extractTrace: [],
      });

      expect(problems).toEqual([expect.stringContaining('symlinked')]);
    });
  });
});
