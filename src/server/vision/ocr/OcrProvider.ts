import { type OcrLanguage } from '@/domain/enums/OcrLanguage';
import { type OcrPageSegMode } from '@/domain/enums/OcrPageSegMode';

/** One OCR job: a small grayscale/binary PNG (cell, name, title or legend crop). */
export type OcrRequest = {
  image: Buffer;
  languages: OcrLanguage[];
  /** Allowed characters, null = the language's full set. */
  whitelist: string | null;
  pageSegMode: OcrPageSegMode;
  /** Once aborted, the job is skipped (also when it is still queued) and rejects with the abort reason. */
  signal?: AbortSignal;
};

export type OcrText = {
  text: string;
  /** Engine confidence 0–100 for the whole recognized text. */
  confidence: number;
};

/**
 * Server-only OCR boundary (Spec §20): AI-free text recognition behind an interface so the engine can be
 * swapped. Implementations must run without system binaries and keep language data out of Git.
 */
export type OcrProvider = {
  recognize: (request: OcrRequest) => Promise<OcrText>;
  /** Releases workers; the provider is unusable afterwards. */
  terminate: () => Promise<void>;
};
