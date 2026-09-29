import { type NextRequest } from 'next/server';

import { type PublicConfigResponse } from '@/domain/types/api/PublicConfigResponse';
import { getAppConfig } from '@/server/config/AppConfig';
import { getPricing } from '@/server/config/PricingConfig';
import { jsonResponse, withRoute } from '@/server/http/RouteHelpers';

export const runtime = 'nodejs';

export const GET = withRoute(async (_request: NextRequest) => {
  const config = getAppConfig();
  const pricing = getPricing(config);
  const body: PublicConfigResponse = {
    appMode: config.appMode,
    priceKrw: pricing.priceKrw,
    freeMonthLimit: pricing.freeMonthLimit,
    authProviders: config.authProviders,
    paymentProvider: config.paymentProvider,
    visionProvider: config.visionProvider,
    uploadMaxBytes: config.uploadMaxBytes,
  };

  return jsonResponse(body);
});
