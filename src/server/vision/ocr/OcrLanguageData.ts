import { access } from 'node:fs/promises';
import path from 'node:path';

import { type OcrLanguage } from '@/domain/enums/OcrLanguage';

/**
 * LSTM-only integer models, the set tesseract.js itself downloads for LSTM workers. They ship in the
 * `@tesseract.js-data/<lang>` npm packages (Spec §21-9), so no network or cache writes are needed.
 */
export const OCR_LANGUAGE_DATA_VARIANT = '4.0.0_best_int';

/**
 * Folder holding `<lang>.traineddata.gz`, resolved at runtime from the app root like the migrations
 * (`process.cwd()` is the deployment root on Vercel and the project root locally). The extract route
 * traces these files into its bundle (next.config.ts).
 */
export const resolveOcrLanguageDir = (language: OcrLanguage, root: string = process.cwd()): string =>
  path.join(
    /* turbopackIgnore: true */ root,
    'node_modules',
    '@tesseract.js-data',
    language,
    OCR_LANGUAGE_DATA_VARIANT,
  );

export const resolveOcrLanguageFile = (language: OcrLanguage, root?: string): string =>
  path.join(resolveOcrLanguageDir(language, root), `${language}.traineddata.gz`);

/** Resolves when the bundled data file is readable. */
export const checkOcrLanguageData = async (language: OcrLanguage, root?: string): Promise<void> => {
  await access(resolveOcrLanguageFile(language, root));
};
