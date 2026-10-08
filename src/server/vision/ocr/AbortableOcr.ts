import { type OcrProvider } from '@/server/vision/ocr/OcrProvider';

/**
 * Binds `signal` to every OCR job: a call after the abort rejects at once, and jobs already queued on a
 * worker are skipped when dequeued (the provider checks the request's signal). Without a signal the
 * provider is returned as is.
 */
export const bindOcrSignal = (ocr: OcrProvider, signal: AbortSignal | undefined): OcrProvider => {
  if (!signal) {
    return ocr;
  }

  return {
    recognize: async (request) => {
      signal.throwIfAborted();

      return ocr.recognize({ ...request, signal });
    },
    terminate: ocr.terminate,
  };
};
