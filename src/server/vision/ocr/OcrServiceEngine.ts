import { tmpdir } from 'node:os';
import path from 'node:path';

import { type OcrProvider } from '@/server/vision/ocr/OcrProvider';
import { createTesseractOcrProvider, OCR_CACHE_DIR } from '@/server/vision/ocr/TesseractOcrProvider';

type RawEnv = Record<string, string | undefined>;

/** Serverless functions: one worker per language (memory), reused by every invocation of the instance. */
const SERVERLESS_POOL_SIZE = 1;
const LOCAL_POOL_SIZE = 2;
const SERVERLESS_CACHE_DIR_NAME = 'offnal-ocr';

const isServerless = (env: RawEnv): boolean => Boolean(env.VERCEL);

/** Writable language-data cache: the function's temp dir on Vercel (read-only bundle), `.data/ocr` locally. */
export const resolveOcrCacheDir = (env: RawEnv = process.env): string =>
  isServerless(env) ? path.join(tmpdir(), SERVERLESS_CACHE_DIR_NAME) : OCR_CACHE_DIR;

export const resolveOcrPoolSize = (env: RawEnv = process.env): number =>
  isServerless(env) ? SERVERLESS_POOL_SIZE : LOCAL_POOL_SIZE;

/** The instance's OCR engine; `coldStart` is true for the first run on a new engine (workers not started). */
export type ServiceOcr = {
  provider: OcrProvider;
  coldStart: boolean;
  /** Terminates and forgets this engine (after a timeout, so queued jobs do not pile up on the workers). */
  discard: () => Promise<void>;
};

type EngineGlobal = typeof globalThis & { __offnalServiceOcr?: OcrProvider };

const engineGlobal = globalThis as EngineGlobal;

/** Shared engine of this server instance, created on first use and never terminated between requests. */
export const acquireServiceOcr = (): ServiceOcr => {
  const existing = engineGlobal.__offnalServiceOcr;
  const provider =
    existing ??
    createTesseractOcrProvider({ cacheDir: resolveOcrCacheDir(), poolSize: resolveOcrPoolSize() });

  engineGlobal.__offnalServiceOcr = provider;

  return {
    provider,
    coldStart: existing === undefined,
    discard: async () => {
      if (engineGlobal.__offnalServiceOcr === provider) {
        engineGlobal.__offnalServiceOcr = undefined;
      }

      await provider.terminate();
    },
  };
};
