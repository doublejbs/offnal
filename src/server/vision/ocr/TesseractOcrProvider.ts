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

  /** Starts `poolSize` workers; if any fails, the ones that started are terminated before rethrowing. */
  const startPool = async (languages: string[]): Promise<PooledWorker[]> => {
    await mkdir(cacheDir, { recursive: true });

    const settled = await Promise.allSettled(
      Array.from({ length: poolSize }, () => createWorker(languages, OEM.LSTM_ONLY, { cachePath: cacheDir })),
    );
    const workers = settled.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
    const failure = settled.find((result) => result.status === 'rejected');

    if (failure) {
      await Promise.allSettled(workers.map((worker) => worker.terminate()));

      throw failure.reason;
    }

    return workers.map((worker) => ({ worker, params: '', queue: Promise.resolve(), pending: 0 }));
  };

  const getPool = (languages: string[]): Promise<PooledWorker[]> => {
    const key = languages.join('+');
    const existing = pools.get(key);

    if (existing) {
      return existing;
    }

    // A failed start is forgotten so a later call can retry (and terminate() does not see it).
    const created = startPool(languages).catch((error: unknown) => {
      if (pools.get(key) === created) {
        pools.delete(key);
      }

      throw error;
    });

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

  /** Terminates every pool that started; a pool that failed to start already released its workers. */
  const terminate = async (): Promise<void> => {
    const settled = await Promise.allSettled(pools.values());

    pools.clear();

    const results = await Promise.allSettled(
      settled.flatMap((result) =>
        result.status === 'fulfilled' ? result.value.map((item) => item.worker.terminate()) : [],
      ),
    );
    const failure = results.find((result) => result.status === 'rejected');

    if (failure) {
      throw failure.reason;
    }
  };

  return { recognize, terminate };
};
