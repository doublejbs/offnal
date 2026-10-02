import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { createWorker, OEM, type Worker } from 'tesseract.js';

import { type OcrProvider, type OcrRequest, type OcrText } from '@/server/vision/ocr/OcrProvider';

/** Language data is downloaded once into this git-ignored cache (never committed). */
export const OCR_CACHE_DIR = path.join('.data', 'ocr');

/** Parallel workers per language set (each is a WASM instance in a worker thread). */
const DEFAULT_POOL_SIZE = 4;
/** Crops carry no DPI; glyphs are rendered ~44px tall, which Tesseract expects at about 300 DPI. */
const OCR_DPI = '300';

type PooledWorker = {
  worker: Worker;
  /** Parameters last applied, to skip redundant setParameters calls. */
  params: string;
  /** Jobs on one worker run strictly one after another (parameters are per worker). */
  queue: Promise<unknown>;
  pending: number;
};

export type TesseractOptions = {
  cacheDir?: string;
  poolSize?: number;
};

/**
 * OCR on tesseract.js (Tesseract compiled to WebAssembly): runs in Node without system binaries, supports
 * Korean + English LSTM models and per-job character whitelists. One worker pool per language set.
 */
export const createTesseractOcrProvider = (options: TesseractOptions = {}): OcrProvider => {
  const cacheDir = options.cacheDir ?? OCR_CACHE_DIR;
  const poolSize = options.poolSize ?? DEFAULT_POOL_SIZE;
  const pools = new Map<string, Promise<PooledWorker[]>>();

  const getPool = (languages: string[]): Promise<PooledWorker[]> => {
    const key = languages.join('+');
    const existing = pools.get(key);

    if (existing) {
      return existing;
    }

    const created = (async () => {
      await mkdir(cacheDir, { recursive: true });

      const workers = await Promise.all(
        Array.from({ length: poolSize }, () =>
          createWorker(languages, OEM.LSTM_ONLY, { cachePath: cacheDir }),
        ),
      );

      return workers.map((worker) => ({ worker, params: '', queue: Promise.resolve(), pending: 0 }));
    })();

    pools.set(key, created);

    return created;
  };

  const recognize = async (request: OcrRequest): Promise<OcrText> => {
    const pool = await getPool(request.languages);
    const slot = pool.reduce((best, item) => (item.pending < best.pending ? item : best), pool[0]!);
    const params = {
      tessedit_pageseg_mode: request.pageSegMode,
      tessedit_char_whitelist: request.whitelist ?? '',
      user_defined_dpi: OCR_DPI,
    };
    const paramsKey = JSON.stringify(params);

    slot.pending += 1;

    const job = slot.queue.then(async () => {
      if (slot.params !== paramsKey) {
        // tesseract.js types PSM as its own enum; our enum holds the same Tesseract numbers.
        await slot.worker.setParameters(params as unknown as Parameters<Worker['setParameters']>[0]);
        slot.params = paramsKey;
      }

      const { data } = await slot.worker.recognize(request.image);

      return { text: data.text.trim(), confidence: data.confidence };
    });

    slot.queue = job.catch(() => undefined);

    try {
      return await job;
    } finally {
      slot.pending -= 1;
    }
  };

  const terminate = async (): Promise<void> => {
    const all = await Promise.all(pools.values());

    pools.clear();
    await Promise.all(all.flat().map((item) => item.worker.terminate()));
  };

  return { recognize, terminate };
};
