/**
 * Build guard for the OCR engine bundle (Spec §22-11), run right after `next build`:
 *
 *   pnpm build   # next build && tsx scripts/CheckOcrBundle.ts
 *
 * Fails the build when the internal OCR route's trace misses a file the tesseract.js worker loads at run
 * time (worker script, packages it requires by name, WASM cores, kor/eng data), when any of its files sits
 * under a symlinked directory (Vercel rejects such a function package), or when the extract function's
 * trace contains tesseract. Paths are built with `path` only, so it runs the same on Vercel (Linux).
 */
import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';

import { checkOcrBundle, readTraceFiles } from '@/server/vision/ocr/OcrBundleCheck';

const ROOT = realpathSync(path.resolve(import.meta.dirname, '..'));
const APP_DIR = path.join(ROOT, '.next', 'server', 'app');
const OCR_TRACE = path.join(APP_DIR, 'api', 'internal', 'ocr-shadow', 'route.js.nft.json');
const EXTRACT_TRACE = path.join(APP_DIR, 'api', 'recognitions', '[id]', 'extract', 'route.js.nft.json');

const run = (): number => {
  const missing = [OCR_TRACE, EXTRACT_TRACE].filter((file) => !existsSync(file));

  if (missing.length > 0) {
    console.error('[ocr-bundle] trace not found (run next build first):', missing);

    return 1;
  }

  const ocrTrace = readTraceFiles(OCR_TRACE);
  const problems = checkOcrBundle({ root: ROOT, ocrTrace, extractTrace: readTraceFiles(EXTRACT_TRACE) });

  if (problems.length > 0) {
    console.error(`[ocr-bundle] ${problems.length} problem(s):\n- ${problems.join('\n- ')}`);

    return 1;
  }

  console.log(`[ocr-bundle] ok: OCR route traces ${ocrTrace.length} files, extract has no tesseract`);

  return 0;
};

process.exitCode = run();
