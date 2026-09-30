import { describe, expect, it } from 'vitest';

import {
  DEMO_BANNER_TEXT,
  getEnvironmentBannerText,
  MOCK_PAYMENT_BANNER_TEXT,
  MOCK_VISION_BANNER_TEXT,
  TEST_PROVIDERS_BANNER_TEXT,
} from '@/client/EnvironmentBanner';
import { AppMode } from '@/domain/enums/AppMode';

describe('getEnvironmentBannerText', () => {
  it('shows the demo banner in demo mode', () => {
    expect(getEnvironmentBannerText({ appMode: AppMode.DEMO, isMockVision: true, isMockPayment: true })).toBe(
      DEMO_BANNER_TEXT,
    );
  });

  it('shows a test-environment banner whenever a live deployment uses a mock provider', () => {
    expect(getEnvironmentBannerText({ appMode: AppMode.LIVE, isMockVision: true, isMockPayment: true })).toBe(
      TEST_PROVIDERS_BANNER_TEXT,
    );
    expect(
      getEnvironmentBannerText({ appMode: AppMode.LIVE, isMockVision: true, isMockPayment: false }),
    ).toBe(MOCK_VISION_BANNER_TEXT);
    expect(
      getEnvironmentBannerText({ appMode: AppMode.LIVE, isMockVision: false, isMockPayment: true }),
    ).toBe(MOCK_PAYMENT_BANNER_TEXT);
  });

  it('shows nothing for a fully live deployment', () => {
    expect(
      getEnvironmentBannerText({ appMode: AppMode.LIVE, isMockVision: false, isMockPayment: false }),
    ).toBeNull();
  });
});
