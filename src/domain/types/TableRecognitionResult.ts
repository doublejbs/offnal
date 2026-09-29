import { type RecognitionErrorCode } from '@/domain/enums/RecognitionErrorCode';
import { type TableRecognition } from '@/domain/types/TableRecognition';

export type TableRecognitionResult =
  { ok: true; value: TableRecognition } | { ok: false; errorCode: RecognitionErrorCode };
