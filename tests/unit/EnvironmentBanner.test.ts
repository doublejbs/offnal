import { describe, expect, it } from 'vitest';

import {
  DEMO_BANNER_TEXT,
  DEMO_BETA_BANNER_TEXT,
  getEnvironmentBannerText,
  MOCK_PAYMENT_BANNER_TEXT,
  MOCK_VISION_BANNER_TEXT,
  TEST_PROVIDERS_BANNER_TEXT,
} from '@/client/EnvironmentBanner';
import { AppMode } from '@/domain/enums/AppMode';
import { BillingMode } from '@/domain/enums/BillingMode';

const PAID = { billingMode: BillingMode.PAID };
const BETA = { billingMode: BillingMode.BETA_FREE };
const BILLING_WORDS = /결제|청구|무료|이용권|구매|\d원/;

describe('getEnvironmentBannerText', () => {
  it('shows the demo banner in demo mode', () => {
    expect(
      getEnvironmentBannerText({ ...PAID, appMode: AppMode.DEMO, isMockVision: true, isMockPayment: true }),
    ).toBe(DEMO_BANNER_TEXT);
  });

  it('shows a test-environment banner whenever a live deployment uses a mock provider', () => {
    expect(
      getEnvironmentBannerText({ ...PAID, appMode: AppMode.LIVE, isMockVision: true, isMockPayment: true }),
    ).toBe(TEST_PROVIDERS_BANNER_TEXT);
    expect(
      getEnvironmentBannerText({ ...PAID, appMode: AppMode.LIVE, isMockVision: true, isMockPayment: false }),
    ).toBe(MOCK_VISION_BANNER_TEXT);
    expect(
      getEnvironmentBannerText({ ...PAID, appMode: AppMode.LIVE, isMockVision: false, isMockPayment: true }),
    ).toBe(MOCK_PAYMENT_BANNER_TEXT);
  });

  it('shows nothing for a fully live deployment', () => {
    expect(
      getEnvironmentBannerText({ ...PAID, appMode: AppMode.LIVE, isMockVision: false, isMockPayment: false }),
    ).toBeNull();
  });

  it('beta free: no payment wording in the demo banner, mock recognition notice stays', () => {
    expect(
      getEnvironmentBannerText({ ...BETA, appMode: AppMode.DEMO, isMockVision: true, isMockPayment: true }),
    ).toBe(DEMO_BETA_BANNER_TEXT);
    expect(DEMO_BETA_BANNER_TEXT).not.toMatch(BILLING_WORDS);
    expect(
      getEnvironmentBannerText({ ...BETA, appMode: AppMode.LIVE, isMockVision: true, isMockPayment: true }),
    ).toBe(MOCK_VISION_BANNER_TEXT);
    expect(MOCK_VISION_BANNER_TEXT).not.toMatch(BILLING_WORDS);
  });

  it('beta free: never shows the test payment banner', () => {
    expect(
      getEnvironmentBannerText({ ...BETA, appMode: AppMode.LIVE, isMockVision: false, isMockPayment: true }),
    ).toBeNull();
  });
});
