import 'server-only';

import { PaymentProviderType } from '@/domain/enums/PaymentProviderType';
import { VisionProviderType } from '@/domain/enums/VisionProviderType';
import { type PublicConfigResponse } from '@/domain/types/api/PublicConfigResponse';
import { type AppConfig, getAppConfig } from '@/server/config/AppConfig';
import { getPricing } from '@/server/config/PricingConfig';

/** Non-secret settings for the UI: GET /api/config/public and the root layout share this. */
export const buildPublicConfig = (config: AppConfig = getAppConfig()): PublicConfigResponse => {
  const pricing = getPricing(config);

  return {
    appMode: config.appMode,
    priceKrw: pricing.priceKrw,
    freeMonthLimit: pricing.freeMonthLimit,
    authProviders: config.authProviders,
    paymentProvider: config.paymentProvider,
    visionProvider: config.visionProvider,
    isMockVision: config.visionProvider === VisionProviderType.MOCK,
    isMockPayment: config.paymentProvider === PaymentProviderType.MOCK,
    uploadMaxBytes: config.uploadMaxBytes,
  };
};
