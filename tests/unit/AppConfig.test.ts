import { describe, expect, it } from 'vitest';

import { AppMode } from '@/domain/enums/AppMode';
import { AuthProviderType } from '@/domain/enums/AuthProviderType';
import { OffnalEnv } from '@/domain/enums/OffnalEnv';
import { PaymentProviderType } from '@/domain/enums/PaymentProviderType';
import { StorageDriver } from '@/domain/enums/StorageDriver';
import { VisionEffort } from '@/domain/enums/VisionEffort';
import { VisionProviderType } from '@/domain/enums/VisionProviderType';
import { parseAppConfig } from '@/server/config/AppConfig';
import { DEFAULT_FREE_MONTH_LIMIT, DEFAULT_PRICE_KRW } from '@/server/config/PricingConfig';

const VALID_PRODUCTION_ENV: Record<string, string> = {
  OFFNAL_ENV: 'production',
  APP_MODE: 'live',
  APP_URL: 'https://offnal.example',
  APP_SECRET: 'x'.repeat(48),
  DATABASE_URL: 'postgres://user:pass@db.example:5432/offnal',
  STORAGE_DRIVER: 's3',
  S3_BUCKET: 'offnal-sources',
  AUTH_PROVIDERS: 'google',
  VISION_PROVIDER: 'anthropic',
  PAYMENT_PROVIDER: 'toss',
};

const withOverrides = (
  overrides: Record<string, string | undefined>,
): Record<string, string | undefined> => ({
  ...VALID_PRODUCTION_ENV,
  ...overrides,
});

describe('parseAppConfig', () => {
  it('accepts a complete production configuration', () => {
    const config = parseAppConfig(VALID_PRODUCTION_ENV);

    expect(config).toMatchObject({
      offnalEnv: OffnalEnv.PRODUCTION,
      appMode: AppMode.LIVE,
      storageDriver: StorageDriver.S3,
      authProviders: [AuthProviderType.GOOGLE],
      visionProvider: VisionProviderType.ANTHROPIC,
      paymentProvider: PaymentProviderType.TOSS,
      visionModel: 'claude-opus-5-5',
      visionEffort: VisionEffort.MEDIUM,
      priceKrw: DEFAULT_PRICE_KRW,
      freeMonthLimit: DEFAULT_FREE_MONTH_LIMIT,
      sourceTtlHours: 24,
      draftTtlDays: 30,
    });
  });

  it.each([
    ['APP_MODE=demo', { APP_MODE: 'demo' }],
    ['VISION_PROVIDER=mock', { VISION_PROVIDER: 'mock' }],
    ['PAYMENT_PROVIDER=mock', { PAYMENT_PROVIDER: 'mock' }],
    ['AUTH_PROVIDERS includes dev', { AUTH_PROVIDERS: 'google,dev' }],
    ['STORAGE_DRIVER=local', { STORAGE_DRIVER: 'local' }],
    ['missing DATABASE_URL (PGlite)', { DATABASE_URL: undefined }],
    ['missing APP_SECRET', { APP_SECRET: undefined }],
    ['short APP_SECRET', { APP_SECRET: 'short-secret' }],
    ['missing APP_URL', { APP_URL: undefined }],
  ])('throws in production with %s', (_label, overrides) => {
    expect(() => parseAppConfig(withOverrides(overrides))).toThrow();
  });

  it('throws when production defaults would fall back to demo providers', () => {
    expect(() =>
      parseAppConfig(
        withOverrides({ APP_MODE: 'demo', VISION_PROVIDER: undefined, PAYMENT_PROVIDER: undefined }),
      ),
    ).toThrow();
  });

  it('defaults demo mode to mock/dev/local providers', () => {
    const config = parseAppConfig({ OFFNAL_ENV: 'development', APP_MODE: 'demo' });

    expect(config).toMatchObject({
      visionProvider: VisionProviderType.MOCK,
      paymentProvider: PaymentProviderType.MOCK,
      authProviders: [AuthProviderType.DEV],
      storageDriver: StorageDriver.LOCAL,
      mockVisionDelayMs: 1200,
    });
    expect(config.appSecret.length).toBeGreaterThanOrEqual(32);
  });

  it('adds dev login in demo mode and strips it in live mode', () => {
    expect(
      parseAppConfig({ OFFNAL_ENV: 'development', APP_MODE: 'demo', AUTH_PROVIDERS: 'google' }).authProviders,
    ).toEqual([AuthProviderType.GOOGLE, AuthProviderType.DEV]);
    expect(
      parseAppConfig({ OFFNAL_ENV: 'development', APP_MODE: 'live', AUTH_PROVIDERS: 'google,dev' })
        .authProviders,
    ).toEqual([AuthProviderType.GOOGLE]);
  });

  it('rejects invalid values', () => {
    expect(() => parseAppConfig({ OFFNAL_ENV: 'staging' })).toThrow();
    expect(() => parseAppConfig({ OFFNAL_ENV: 'development', VISION_PROVIDER: 'openai' })).toThrow();
    expect(() => parseAppConfig({ OFFNAL_ENV: 'development', PRICE_KRW: '-1' })).toThrow();
    expect(() => parseAppConfig({ OFFNAL_ENV: 'development', AUTH_PROVIDERS: 'google,apple' })).toThrow();
  });

  it('reads price and free month limit overrides', () => {
    const config = parseAppConfig({ OFFNAL_ENV: 'development', PRICE_KRW: '2500', FREE_MONTH_LIMIT: '3' });

    expect(config.priceKrw).toBe(2500);
    expect(config.freeMonthLimit).toBe(3);
  });
});
