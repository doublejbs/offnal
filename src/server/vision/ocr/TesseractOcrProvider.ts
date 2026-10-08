import { createWorker, OEM, type Worker } from 'tesseract.js';

import { type OcrLanguage } from '@/domain/enums/OcrLanguage';
import { OcrShadowErrorKind } from '@/domain/enums/OcrShadowErrorKind';
import { OcrEngineError, toOcrEngineError } from '@/server/vision/ocr/OcrEngineError';
import { checkOcrLanguageData, resolveOcrLanguageDir } from '@/server/vision/ocr/OcrLanguageData';
import { type OcrProvider, type OcrRequest, type OcrText } from '@/server/vision/ocr/OcrProvider';

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
  /** Rejects when the worker thread emits `error` (it has exited: its queued jobs would never settle). */
  crashed: Promise<never>;
};

type WorkerThread = { on: (event: 'error', listener: (error: unknown) => void) => unknown };

export type TesseractOptions = {
  /** App root holding `node_modules/@tesseract.js-data` (default `process.cwd()`). */
  dataRoot?: string;
  poolSize?: number;
};

/**
 * Without an `errorHandler`, tesseract.js rethrows every worker-side rejection inside its `message`
 * listener, an uncaught exception that would take the whole instance down. The job still rejects.
 */
const ignoreWorkerReject = (): void => undefined;

/**
 * tesseract.js 7 returns its Node `worker_threads` Worker as an untyped `worker` field. It only assigns
 * `worker.onerror`, which a Node Worker ignores, so a thread crash would be an unhandled `error` event.
 */
const readWorkerThread = (worker: Worker): WorkerThread | null => {
  const thread = (worker as unknown as { worker?: Partial<WorkerThread> | null }).worker;

  if (thread && typeof thread.on === 'function') {
    return thread as WorkerThread;
  }

  return null;
};

const watchWorkerThread = (worker: Worker): Promise<never> =>
  new Promise<never>((_resolve, reject) => {
    readWorkerThread(worker)?.on('error', () => reject(new OcrEngineError(OcrShadowErrorKind.RECOGNIZE)));
  });

/**
 * OCR on tesseract.js (Tesseract compiled to WebAssembly): runs in Node without system binaries, supports
 * Korean + English LSTM models and per-job character whitelists. One worker pool per language. Language
 * data is read from the bundled `@tesseract.js-data` packages (no download, no cache writes).
 * After `terminate()` (or a worker crash) every call rejects and no worker is started again.
 */
export const createTesseractOcrProvider = (options: TesseractOptions = {}): OcrProvider => {
  const poolSize = options.poolSize ?? DEFAULT_POOL_SIZE;
  const pools = new Map<string, Promise<PooledWorker[]>>();
  let terminated = false;
  let crashed = false;

  /** Throws the abort reason, or an engine error once the provider is terminated or crashed. */
  const assertUsable = (request?: OcrRequest): void => {
    request?.signal?.throwIfAborted();

    if (terminated || crashed) {
      throw new OcrEngineError(OcrShadowErrorKind.RECOGNIZE);
    }
  };

  const toPooledWorker = (worker: Worker): PooledWorker => {
    const watched = watchWorkerThread(worker);

    // Observed here so a crash with no job waiting is not an unhandled rejection.
    watched.catch(() => {
      crashed = true;
    });

    return { worker, params: '', queue: Promise.resolve(), pending: 0, crashed: watched };
  };

  /** Starts `poolSize` workers; if any fails, the ones that started are terminated before rethrowing. */
  const startPool = async (languages: OcrLanguage[]): Promise<PooledWorker[]> => {
    const [language] = languages;

    // Each data package has its own folder, and tesseract.js takes one `langPath` per worker.
    if (language === undefined || languages.length !== 1) {
      throw new OcrEngineError(OcrShadowErrorKind.WORKER_INIT);
    }

    await checkOcrLanguageData(language, options.dataRoot).catch(() => {
      throw new OcrEngineError(OcrShadowErrorKind.DOWNLOAD);
    });
    assertUsable();

    const settled = await Promise.allSettled(
      Array.from({ length: poolSize }, () =>
        createWorker(languages, OEM.LSTM_ONLY, {
          langPath: resolveOcrLanguageDir(language, options.dataRoot),
          cacheMethod: 'none',
          errorHandler: ignoreWorkerReject,
        }),
      ),
    );
    const workers = settled.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
    const failed = settled.some((result) => result.status === 'rejected');

    // Also when terminate() ran meanwhile: it may have missed these workers.
    if (failed || terminated) {
      await Promise.allSettled(workers.map((worker) => worker.terminate()));

      throw new OcrEngineError(failed ? OcrShadowErrorKind.WORKER_INIT : OcrShadowErrorKind.RECOGNIZE);
    }

    return workers.map(toPooledWorker);
  };

  const getPool = (languages: OcrLanguage[]): Promise<PooledWorker[]> => {
    if (terminated || crashed) {
      return Promise.reject(new OcrEngineError(OcrShadowErrorKind.RECOGNIZE));
    }

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

  const runJob = async (slot: PooledWorker, request: OcrRequest): Promise<OcrText> => {
    // Dequeued after an abort or terminate(): skip the CPU work.
    assertUsable(request);

    const params = {
      tessedit_pageseg_mode: request.pageSegMode,
      tessedit_char_whitelist: request.whitelist ?? '',
      user_defined_dpi: OCR_DPI,
    };
    const paramsKey = JSON.stringify(params);

    if (slot.params !== paramsKey) {
      // tesseract.js types PSM as its own enum; our enum holds the same Tesseract numbers.
      await slot.worker.setParameters(params as unknown as Parameters<Worker['setParameters']>[0]);
      slot.params = paramsKey;
    }

    const { data } = await slot.worker.recognize(request.image);

    return { text: data.text.trim(), confidence: data.confidence };
  };

  const recognize = async (request: OcrRequest): Promise<OcrText> => {
    assertUsable(request);

    const pool = await getPool(request.languages);
    const slot = pool.reduce((best, item) => (item.pending < best.pending ? item : best), pool[0]!);

    slot.pending += 1;

    const job = slot.queue.then(() => runJob(slot, request));

    slot.queue = job.catch(() => undefined);

    try {
      return await Promise.race([job, slot.crashed]);
    } catch (error: unknown) {
      if (request.signal?.aborted) {
        throw request.signal.reason;
      }

      throw toOcrEngineError(error, OcrShadowErrorKind.RECOGNIZE);
    } finally {
      slot.pending -= 1;
    }
  };

  /** Terminates every pool that started; a pool that failed to start already released its workers. */
  const terminate = async (): Promise<void> => {
    terminated = true;

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
