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

/** Token usage of one provider call (used by the model comparison eval; never stored). */
export type VisionUsage = {
  inputTokens: number;
  /** Visible output tokens. For Anthropic this already includes thinking tokens. */
  outputTokens: number;
  /** Thinking tokens billed as output, or null when the provider does not report them separately. */
  thinkingTokens: number | null;
};

/** `usage` sits beside `value`, so storing `result.value` never persists it. */
export type VisionTableResult = TableRecognitionResult & { usage?: VisionUsage };

export type VisionPersonResult = PersonExtraction & { usage?: VisionUsage };

/** Server-only image recognition boundary (Spec §8). */
export type VisionProvider = {
  readonly kind: VisionProviderType;
  /** First pass: table structure, name candidates, month, codes and times. */
  recognizeTable: (image: VisionImage, signal: AbortSignal) => Promise<VisionTableResult>;
  /** Second pass: one person's whole month. Throws VisionProviderError on failure. */
  extractPerson: (
    image: VisionImage,
    input: PersonExtractionInput,
    signal: AbortSignal,
  ) => Promise<VisionPersonResult>;
};

/** Provider failure with a recognition error code (timeout, refusal, missing key, …). */
export class VisionProviderError extends Error {
  readonly errorCode: RecognitionErrorCode;

  /** `cause` keeps the SDK error (e.g. HTTP status) for retry decisions; never logged with image data. */
  constructor(errorCode: RecognitionErrorCode, options?: { cause?: unknown }) {
    super(`Vision provider failed: ${errorCode}`, options);
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

/** HTTP status kept on a provider failure's SDK cause (e.g. 429 rate limit, 404 unknown model), or null. */
export const getProviderErrorStatus = (error: unknown): number | null => {
  const cause = error instanceof VisionProviderError ? error.cause : error;

  if (typeof cause === 'object' && cause !== null && 'status' in cause && typeof cause.status === 'number') {
    return cause.status;
  }

  return null;
};
