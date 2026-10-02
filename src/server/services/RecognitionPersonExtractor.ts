import 'server-only';

import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { RecognitionErrorCode } from '@/domain/enums/RecognitionErrorCode';
import { normalizeExtraction } from '@/domain/ScheduleValidator';
import { type NormalizedSchedule } from '@/domain/types/NormalizedSchedule';
import { type PersonExtraction } from '@/domain/types/PersonExtraction';
import { type TableRecognition } from '@/domain/types/TableRecognition';
import { getAppConfig } from '@/server/config/AppConfig';
import { type RecognitionJobRow } from '@/server/db/Schema';
import { ApiError, SOURCE_GONE_MESSAGE } from '@/server/errors/ApiError';
import { isSourceAvailable } from '@/server/services/RecognitionOwnership';
import { loadSourceForVision } from '@/server/services/RecognitionProcessService';
import { buildRowContext } from '@/server/vision/RowIdentity';
import { getVisionProvider } from '@/server/vision/VisionFactory';
import {
  extractPersonWithPipeline,
  type PipelineCallRunner,
  type PreparedPipelineImage,
  preparePipelineImage,
} from '@/server/vision/VisionPipeline';
import { toRecognitionErrorCode } from '@/server/vision/VisionProvider';

const toProviderApiError = (code: RecognitionErrorCode): ApiError => {
  if (code === RecognitionErrorCode.PROVIDER_NOT_CONFIGURED) {
    return new ApiError(ApiErrorCode.PROVIDER_NOT_CONFIGURED);
  }

  if (code === RecognitionErrorCode.SOURCE_MISSING) {
    return new ApiError(ApiErrorCode.EXPIRED, { message: SOURCE_GONE_MESSAGE });
  }

  return new ApiError(ApiErrorCode.PROVIDER_ERROR, { details: { reason: code } });
};

/** Pass-1 table + prepared (possibly warped) image, shared by every person read from one photo. */
export type PreparedJobImage = {
  table: TableRecognition;
  prepared: PreparedPipelineImage;
  /** Original upload bytes (memory only, same lifetime as `prepared`). */
  sourceBytes: Buffer;
};

export type PreparedJobImageResult =
  { ok: true; image: PreparedJobImage } | { ok: false; errorCode: RecognitionErrorCode };

/** Loads the job's source and prepares the pipeline image once (memory only); failures as error codes. */
export const tryPrepareJobImage = async (
  job: RecognitionJobRow,
  table: TableRecognition,
): Promise<PreparedJobImageResult> => {
  if (!isSourceAvailable(job)) {
    return { ok: false, errorCode: RecognitionErrorCode.SOURCE_MISSING };
  }

  const source = await loadSourceForVision(job);

  if (!source.ok) {
    return source;
  }

  // The warped image lives only in memory for this request (source lifetime rules unchanged).
  return {
    ok: true,
    image: {
      table,
      prepared: await preparePipelineImage(getAppConfig().visionPipeline, source.image, table.grid),
      sourceBytes: source.bytes,
    },
  };
};

/** Like tryPrepareJobImage, failures as ApiError (410 source gone, 502/503 provider). */
const prepareJobImage = async (
  job: RecognitionJobRow,
  table: TableRecognition,
): Promise<PreparedJobImage> => {
  const result = await tryPrepareJobImage(job, table);

  if (!result.ok) {
    throw toProviderApiError(result.errorCode);
  }

  return result.image;
};

/** Raw pipeline call for one row; throws VisionProviderError-derived codes as `RecognitionErrorCode`. */
export const extractRowWithPreparedImage = async (
  image: PreparedJobImage,
  rowId: string,
  name: string,
  yearMonth: string,
): Promise<NormalizedSchedule> => {
  // One budget for every call of the pipeline (locate + extract), like the single call before §15.
  const signal = AbortSignal.timeout(getAppConfig().visionTimeoutMs);
  const runCall: PipelineCallRunner = (_step, run) => run(signal);
  let extraction: PersonExtraction;

  try {
    ({ extraction } = await extractPersonWithPipeline(
      getVisionProvider(),
      image.prepared,
      {
        rowId,
        name,
        yearMonth,
        definitions: image.table.definitions,
        rowContext: buildRowContext(image.table.candidates, rowId),
      },
      runCall,
    ));
  } catch (error: unknown) {
    throw new RowExtractionError(toRecognitionErrorCode(error, signal));
  }

  return normalizeExtraction(extraction, yearMonth);
};

/** Second-pass failure of one row with its recognition error code. */
export class RowExtractionError extends Error {
  readonly errorCode: RecognitionErrorCode;

  constructor(errorCode: RecognitionErrorCode) {
    super(`Row extraction failed: ${errorCode}`);
    this.name = 'RowExtractionError';
    this.errorCode = errorCode;
  }
}

export type PersonScheduleResult = {
  schedule: NormalizedSchedule;
  /** The original photo the pass read (memory only), for the shadow OCR run. */
  sourceBytes: Buffer;
};

/**
 * Second pass for one row through the configured pipeline (Spec §15). Provider call only; normalization
 * runs outside the try so bugs surface as 500, not 502.
 */
export const extractPersonSchedule = async (
  job: RecognitionJobRow,
  table: TableRecognition,
  rowId: string,
  name: string,
  yearMonth: string,
): Promise<PersonScheduleResult> => {
  const image = await prepareJobImage(job, table);

  try {
    return {
      schedule: await extractRowWithPreparedImage(image, rowId, name, yearMonth),
      sourceBytes: image.sourceBytes,
    };
  } catch (error: unknown) {
    if (error instanceof RowExtractionError) {
      throw toProviderApiError(error.errorCode);
    }

    throw error;
  }
};
