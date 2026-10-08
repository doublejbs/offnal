import 'server-only';

import { isBetaFree } from '@/domain/BillingPolicy';
import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { type AppConfig, getAppConfig } from '@/server/config/AppConfig';
import { ApiError } from '@/server/errors/ApiError';

/**
 * Beta free mode (Spec §20.3): every payment API is 404. Call before parsing the body or building a
 * payment provider, so a deployment without Toss keys never reaches the provider (503).
 */
export const assertPaymentsEnabled = (config: Pick<AppConfig, 'billingMode'> = getAppConfig()): void => {
  if (isBetaFree(config)) {
    throw new ApiError(ApiErrorCode.NOT_FOUND);
  }
};
