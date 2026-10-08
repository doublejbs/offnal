import { type OcrShadowErrorKind } from '@/domain/enums/OcrShadowErrorKind';

/**
 * Engine failure with a fixed classification. tesseract.js rejects with message strings (which may quote
 * engine internals), so the original reason is never kept: only the kind leaves the provider.
 */
export class OcrEngineError extends Error {
  readonly kind: OcrShadowErrorKind;

  constructor(kind: OcrShadowErrorKind) {
    super(`OCR engine failed: ${kind}`);
    this.name = 'OcrEngineError';
    this.kind = kind;
  }
}

/** Keeps an existing classification, otherwise classifies the failure as `kind`. */
export const toOcrEngineError = (error: unknown, kind: OcrShadowErrorKind): OcrEngineError =>
  error instanceof OcrEngineError ? error : new OcrEngineError(kind);
