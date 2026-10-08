import { type OcrProvider } from '@/server/vision/ocr/OcrProvider';
import { createTesseractOcrProvider } from '@/server/vision/ocr/TesseractOcrProvider';

type RawEnv = Record<string, string | undefined>;

/** Serverless functions: one worker per language (memory), reused by every invocation of the instance. */
const SERVERLESS_POOL_SIZE = 1;
const LOCAL_POOL_SIZE = 2;

const isServerless = (env: RawEnv): boolean => Boolean(env.VERCEL);

export const resolveOcrPoolSize = (env: RawEnv = process.env): number =>
  isServerless(env) ? SERVERLESS_POOL_SIZE : LOCAL_POOL_SIZE;

/** The instance's OCR engine; `coldStart` is true for the first run on a new engine (workers not started). */
export type ServiceOcr = {
  provider: OcrProvider;
  coldStart: boolean;
  /**
   * Terminates and forgets this engine (after a timeout or an error, so queued jobs or a broken worker do
   * not reach the next run). The terminated provider rejects every later call and starts no workers.
   */
  discard: () => Promise<void>;
};

type EngineGlobal = typeof globalThis & { __offnalServiceOcr?: OcrProvider };

const engineGlobal = globalThis as EngineGlobal;

/**
 * Shared engine of this server instance, created on first use and never terminated between requests.
 * Language data comes from the bundled `@tesseract.js-data` packages (nothing is downloaded or written).
 */
export const acquireServiceOcr = (): ServiceOcr => {
  const existing = engineGlobal.__offnalServiceOcr;
  const provider = existing ?? createTesseractOcrProvider({ poolSize: resolveOcrPoolSize() });

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
