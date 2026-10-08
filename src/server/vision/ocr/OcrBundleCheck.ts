import { readFileSync, realpathSync } from 'node:fs';
import { builtinModules, createRequire } from 'node:module';
import path from 'node:path';

import { OcrLanguage } from '@/domain/enums/OcrLanguage';
import { resolveOcrLanguageFile } from '@/server/vision/ocr/OcrLanguageData';

/** The Node worker entry tesseract.js 7 spawns (`src/worker/node/defaultOptions.js`). */
const WORKER_ENTRY = path.join('node_modules', 'tesseract.js', 'src', 'worker-script', 'node', 'index.js');

/** `require('…')` with a literal specifier (comments included: an unresolvable one is reported). */
const REQUIRE_PATTERN = /require\(\s*['"]([^'"]+)['"]\s*\)/gu;

/**
 * Required by name but never loaded on our runtime: the worker uses `global.fetch || require('node-fetch')`
 * and Node 22 has a global fetch.
 */
const UNUSED_REQUIRES = new Set(['node-fetch']);

const BUILTINS = new Set(builtinModules);

const isBuiltin = (specifier: string): boolean =>
  specifier.startsWith('node:') || BUILTINS.has(specifier.split('/')[0] ?? specifier);

/** `tesseract-core*.js` reads its `.wasm` sibling through fs (not a require). */
const wasmSibling = (file: string): string | null =>
  /tesseract-core[^/\\]*\.js$/u.test(file) && !file.endsWith('.wasm.js')
    ? file.replace(/\.js$/u, '.wasm')
    : null;

/** Name of the package a bare specifier points to (`@scope/name` or `name`). */
const toPackageName = (specifier: string): string => {
  const parts = specifier.split('/');

  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!;
};

/** `…/node_modules/<package>/package.json` of a file resolved from a bare specifier. */
const findPackageManifest = (resolved: string, specifier: string): string => {
  const marker = path.join('node_modules', toPackageName(specifier));
  const index = resolved.lastIndexOf(`${marker}${path.sep}`);

  if (index < 0) {
    throw new Error(`Cannot locate the package of ${specifier}`);
  }

  return path.join(resolved.slice(0, index + marker.length), 'package.json');
};

/**
 * Every file the OCR worker thread loads at run time, found by following its literal requires from the
 * entry (relative files and packages by name), plus the WASM cores and the kor/eng language data.
 * Throws when a require cannot be resolved.
 */
export const listRequiredOcrFiles = (root: string): string[] => {
  const realRoot = realpathSync(root);
  const seen = new Set<string>();
  const pending = [path.join(realRoot, WORKER_ENTRY)];

  while (pending.length > 0) {
    const file = pending.pop()!;

    if (seen.has(file)) {
      continue;
    }

    seen.add(file);

    const wasm = wasmSibling(file);

    if (wasm) {
      seen.add(wasm);
    }

    if (!/\.c?js$/u.test(file)) {
      continue;
    }

    const resolveFrom = createRequire(file);

    for (const match of readFileSync(file, 'utf8').matchAll(REQUIRE_PATTERN)) {
      const specifier = match[1]!;

      if (isBuiltin(specifier) || UNUSED_REQUIRES.has(specifier)) {
        continue;
      }

      const resolved = resolveFrom.resolve(specifier);

      pending.push(resolved);

      if (!specifier.startsWith('.')) {
        // Node reads the package's manifest (`main`/`exports`) to resolve a require by name.
        seen.add(findPackageManifest(resolved, specifier));
      }
    }
  }

  for (const language of [OcrLanguage.KOREAN, OcrLanguage.ENGLISH]) {
    seen.add(resolveOcrLanguageFile(language, realRoot));
  }

  return [...seen].sort();
};

export type OcrBundleTraces = {
  root: string;
  /** Absolute paths traced into the internal OCR route's function. */
  ocrTrace: string[];
  /** Absolute paths traced into the extract function. */
  extractTrace: string[];
};

/** True when some folder between the file and the filesystem root is a symlink. */
const isUnderSymlinkedDirectory = (file: string): boolean => {
  const directory = path.dirname(file);

  try {
    return realpathSync(directory) !== directory;
  } catch {
    return false;
  }
};

/**
 * Problems of a build's function traces (Spec §22-11): a required OCR file missing from the OCR route,
 * any OCR route file under a symlinked directory (Vercel rejects the package), tesseract in the extract
 * function. Empty when the bundle is fine.
 */
export const checkOcrBundle = ({ root, ocrTrace, extractTrace }: OcrBundleTraces): string[] => {
  const problems: string[] = [];
  const traced = new Set(ocrTrace);

  for (const file of listRequiredOcrFiles(root)) {
    if (!traced.has(file)) {
      problems.push(`OCR route is missing ${path.relative(root, file)}`);
    }
  }

  for (const file of ocrTrace) {
    if (isUnderSymlinkedDirectory(file)) {
      problems.push(`OCR route traces a file in a symlinked directory: ${file}`);
    }
  }

  const leaked = extractTrace.filter((file) => file.includes('tesseract'));

  if (leaked.length > 0) {
    problems.push(`extract function traces ${leaked.length} tesseract file(s), e.g. ${leaked[0]}`);
  }

  return problems;
};

/** Absolute paths listed in a `.nft.json` (relative to its folder), the route file itself included. */
export const readTraceFiles = (nftFile: string): string[] => {
  const directory = path.dirname(nftFile);
  const { files } = JSON.parse(readFileSync(nftFile, 'utf8')) as { files: string[] };

  return [nftFile.replace(/\.nft\.json$/u, ''), ...files.map((file) => path.resolve(directory, file))];
};
