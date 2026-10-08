/**
 * Fixed classification of a shadow OCR error (Spec §21-9), stored in `ocr_shadow_runs.error_name`.
 * tesseract.js rejects with plain message strings, so neither class names nor messages are recorded.
 */
export enum OcrShadowErrorKind {
  /** Language data (bundled traineddata) could not be found or read. */
  DOWNLOAD = 'download',
  /** A worker failed to start (WASM core, language load or engine init). */
  WORKER_INIT = 'worker_init',
  /** A started worker failed a job, crashed, or the engine was already terminated. */
  RECOGNIZE = 'recognize',
  /** The uploaded photo could not be decoded. */
  DECODE = 'decode',
  /** The table reader failed outside the engine (geometry, cropping, rendering). */
  TABLE = 'table',
  UNKNOWN = 'unknown',
}
