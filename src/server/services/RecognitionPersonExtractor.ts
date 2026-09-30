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
): Promise<NormalizedSchedule> => {
  if (!isSourceAvailable(job)) {
    throw new ApiError(ApiErrorCode.EXPIRED, { message: SOURCE_GONE_MESSAGE });
  }

  const source = await loadSourceForVision(job);

  if (!source.ok) {
    throw toProviderApiError(source.errorCode);
  }

  const config = getAppConfig();
  // One budget for every call of the pipeline (locate + extract), like the single call before §15.
  const signal = AbortSignal.timeout(config.visionTimeoutMs);
  const runCall: PipelineCallRunner = (_step, run) => run(signal);
  // The warped image lives only in memory for this request (source lifetime rules unchanged).
  const prepared = await preparePipelineImage(config.visionPipeline, source.image, table.grid);
  let extraction: PersonExtraction;

  try {
    ({ extraction } = await extractPersonWithPipeline(
      getVisionProvider(),
      prepared,
      {
        rowId,
        name,
        yearMonth,
        definitions: table.definitions,
        rowContext: buildRowContext(table.candidates, rowId),
      },
      runCall,
    ));
  } catch (error: unknown) {
    throw toProviderApiError(toRecognitionErrorCode(error, signal));
  }

  return normalizeExtraction(extraction, yearMonth);
};
