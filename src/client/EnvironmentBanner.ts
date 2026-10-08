import { isBetaFree } from '@/domain/BillingPolicy';
import { AppMode } from '@/domain/enums/AppMode';
import { type PublicConfigResponse } from '@/domain/types/api/PublicConfigResponse';

export const DEMO_BANNER_TEXT = '개발 데모 모드 · 예시 인식·테스트 결제이며 실제 처리가 아니에요';
/** Beta free mode has no checkout, so the demo notice drops the test payment part (Spec §20.4). */
export const DEMO_BETA_BANNER_TEXT = '개발 데모 모드 · 예시 인식이며 실제 처리가 아니에요';
export const TEST_PROVIDERS_BANNER_TEXT =
  '테스트 환경 · 근무표 인식과 결제는 예시·테스트로 동작해요. 실제 청구 없음';
export const MOCK_VISION_BANNER_TEXT = '테스트 환경 · 근무표 인식은 예시 데이터로 동작해요';
export const MOCK_PAYMENT_BANNER_TEXT = '테스트 환경 · 결제는 테스트로 동작해요. 실제 청구 없음';

type BannerInput = {
  appMode: PublicConfigResponse['appMode'];
  billingMode: PublicConfigResponse['billingMode'];
  isMockVision: boolean;
  isMockPayment: boolean;
};

/**
 * Banner shown on every screen whenever something is not real: demo mode, or a live deployment
 * (development/preview only) that still uses mock recognition and/or mock payment. Null = none.
 * Beta free mode never mentions payment; the mock recognition notice stays.
 */
export const getEnvironmentBannerText = (config: BannerInput): string | null => {
  const isBeta = isBetaFree(config);
  const isMockPayment = !isBeta && config.isMockPayment;

  if (config.appMode === AppMode.DEMO) {
    return isBeta ? DEMO_BETA_BANNER_TEXT : DEMO_BANNER_TEXT;
  }

  if (config.isMockVision && isMockPayment) {
    return TEST_PROVIDERS_BANNER_TEXT;
  }

  if (config.isMockVision) {
    return MOCK_VISION_BANNER_TEXT;
  }

  if (isMockPayment) {
    return MOCK_PAYMENT_BANNER_TEXT;
  }

  return null;
};
