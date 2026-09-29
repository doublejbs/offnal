import { type ImageMimeType } from '@/domain/enums/ImageMimeType';
import { RecognitionErrorCode } from '@/domain/enums/RecognitionErrorCode';
import { type VisionProviderType } from '@/domain/enums/VisionProviderType';
import { type PersonExtraction } from '@/domain/types/PersonExtraction';
import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';
import { type TableRecognitionResult } from '@/domain/types/TableRecognitionResult';

export type VisionImage = {
  bytes: Buffer;
  mime: ImageMimeType;
};

export type PersonExtractionInput = {
  rowId: string;
  name: string;
  /** YYYY-MM chosen by the user. */
  yearMonth: string;
  definitions: ShiftDefinition[];
};

/** Server-only image recognition boundary (Spec §8). */
export type VisionProvider = {
  readonly kind: VisionProviderType;
  /** First pass: table structure, name candidates, month, codes and times. */
  recognizeTable: (image: VisionImage, signal: AbortSignal) => Promise<TableRecognitionResult>;
  /** Second pass: one person's whole month. Throws VisionProviderError on failure. */
  extractPerson: (
    image: VisionImage,
    input: PersonExtractionInput,
    signal: AbortSignal,
  ) => Promise<PersonExtraction>;
};

/** Provider failure with a recognition error code (timeout, refusal, missing key, …). */
export class VisionProviderError extends Error {
  readonly errorCode: RecognitionErrorCode;

  constructor(errorCode: RecognitionErrorCode) {
    super(`Vision provider failed: ${errorCode}`);
    this.name = 'VisionProviderError';
    this.errorCode = errorCode;
  }
}

/** Maps any provider failure (including aborts) to a recognition error code. */
export const toRecognitionErrorCode = (error: unknown, signal: AbortSignal): RecognitionErrorCode => {
  if (error instanceof VisionProviderError) {
    return error.errorCode;
  }

  if (
    signal.aborted ||
    (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError'))
  ) {
    return RecognitionErrorCode.PROVIDER_TIMEOUT;
  }

  return RecognitionErrorCode.PROVIDER_ERROR;
};
