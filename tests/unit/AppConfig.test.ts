import { describe, expect, it } from 'vitest';

import { AppMode } from '@/domain/enums/AppMode';
import { AuthProviderType } from '@/domain/enums/AuthProviderType';
import { BillingMode } from '@/domain/enums/BillingMode';
import { GeminiTier } from '@/domain/enums/GeminiTier';
import { OffnalEnv } from '@/domain/enums/OffnalEnv';
import { PaymentProviderType } from '@/domain/enums/PaymentProviderType';
import { StorageDriver } from '@/domain/enums/StorageDriver';
import { VisionEffort } from '@/domain/enums/VisionEffort';
import { VisionPipelineMode } from '@/domain/enums/VisionPipelineMode';
import { VisionProviderType } from '@/domain/enums/VisionProviderType';
import { parseAppConfig } from '@/server/config/AppConfig';
import { DEFAULT_FREE_MONTH_LIMIT, DEFAULT_PRICE_KRW, isBetaFree } from '@/server/config/PricingConfig';

const VALID_PRODUCTION_ENV: Record<string, string> = {
  OFFNAL_ENV: 'production',
  APP_MODE: 'live',
  APP_URL: 'https://offnal.example',
  APP_SECRET: 'x'.repeat(48),
  DATABASE_URL: 'postgres://user:pass@db.example:5432/offnal',
  STORAGE_DRIVER: 's3',
  S3_BUCKET: 'offnal-sources',
  S3_ENDPOINT: 'https://project-ref.storage.supabase.co/storage/v1/s3',
  S3_REGION: 'ap-northeast-2',
  S3_ACCESS_KEY_ID: 'test-access-key-id',
  S3_SECRET_ACCESS_KEY: 'test-secret-access-key',
  AUTH_PROVIDERS: 'kakao',
  NEXT_PUBLIC_SUPABASE_URL: 'https://project-ref.supabase.co',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
  VISION_PROVIDER: 'anthropic',
  PAYMENT_PROVIDER: 'toss',
  TOSS_CLIENT_KEY: 'live_ck_test',
  TOSS_SECRET_KEY: 'live_sk_test',
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
      authProviders: [AuthProviderType.KAKAO],
      supabaseUrl: 'https://project-ref.supabase.co',
      supabasePublishableKey: 'sb_publishable_test',
      visionProvider: VisionProviderType.ANTHROPIC,
      paymentProvider: PaymentProviderType.TOSS,
      billingMode: BillingMode.PAID,
      visionModel: 'claude-opus-5-5',
      visionEffort: VisionEffort.MEDIUM,
      priceKrw: DEFAULT_PRICE_KRW,
      freeMonthLimit: DEFAULT_FREE_MONTH_LIMIT,
      sourceTtlHours: 24,
      uploadMaxBytes: 4194304,
      draftTtlDays: 30,
    });
  });

  it.each([
    ['APP_MODE=demo', { APP_MODE: 'demo' }],
    ['VISION_PROVIDER=mock', { VISION_PROVIDER: 'mock' }],
    ['PAYMENT_PROVIDER=mock', { PAYMENT_PROVIDER: 'mock' }],
    ['AUTH_PROVIDERS includes dev', { AUTH_PROVIDERS: 'kakao,dev' }],
    ['STORAGE_DRIVER=local', { STORAGE_DRIVER: 'local' }],
    ['unset STORAGE_DRIVER defaulting to local in demo', { STORAGE_DRIVER: undefined, APP_MODE: 'demo' }],
    ['kakao without NEXT_PUBLIC_SUPABASE_URL', { NEXT_PUBLIC_SUPABASE_URL: undefined }],
    ['kakao without a Supabase publishable key', { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined }],
    ['s3 without a bucket', { S3_BUCKET: undefined }],
    ['s3 without access keys', { S3_ACCESS_KEY_ID: undefined }],
    ['missing DATABASE_URL (PGlite)', { DATABASE_URL: undefined }],
    ['missing APP_SECRET', { APP_SECRET: undefined }],
    ['short APP_SECRET', { APP_SECRET: 'short-secret' }],
    ['missing APP_URL', { APP_URL: undefined }],
    ['http APP_URL', { APP_URL: 'http://offnal.example' }],
    ['placeholder CRON_SECRET', { CRON_SECRET: 'change-me-cron-secret' }],
    ['short CRON_SECRET', { CRON_SECRET: 'short-cron-secret' }],
  ])('throws in production with %s', (_label, overrides) => {
    expect(() => parseAppConfig(withOverrides(overrides))).toThrow();
  });

  it('accepts a strong CRON_SECRET in production and leaves cron disabled when unset', () => {
    expect(parseAppConfig(withOverrides({ CRON_SECRET: 'c'.repeat(32) })).cronSecret).toBe('c'.repeat(32));
    expect(parseAppConfig(withOverrides({ CRON_SECRET: undefined })).cronSecret).toBeNull();
    expect(parseAppConfig({ OFFNAL_ENV: 'development', CRON_SECRET: 'short' }).cronSecret).toBe('short');
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
      parseAppConfig({ OFFNAL_ENV: 'development', APP_MODE: 'demo', AUTH_PROVIDERS: 'kakao' }).authProviders,
    ).toEqual([AuthProviderType.KAKAO, AuthProviderType.DEV]);
    expect(
      parseAppConfig({ OFFNAL_ENV: 'development', APP_MODE: 'live', AUTH_PROVIDERS: 'kakao,dev' })
        .authProviders,
    ).toEqual([AuthProviderType.KAKAO]);
  });

  it('rejects invalid values', () => {
    expect(() => parseAppConfig({ OFFNAL_ENV: 'staging' })).toThrow();
    expect(() => parseAppConfig({ OFFNAL_ENV: 'development', VISION_PROVIDER: 'openai' })).toThrow();
    expect(() => parseAppConfig({ OFFNAL_ENV: 'development', PRICE_KRW: '-1' })).toThrow();
    expect(() => parseAppConfig({ OFFNAL_ENV: 'development', AUTH_PROVIDERS: 'kakao,apple' })).toThrow();
    expect(() => parseAppConfig({ OFFNAL_ENV: 'development', AUTH_PROVIDERS: 'google' })).toThrow();
    expect(() => parseAppConfig({ OFFNAL_ENV: 'development', BILLING_MODE: 'free' })).toThrow(/BILLING_MODE/);
  });

  it('defaults BILLING_MODE to paid and reads beta_free', () => {
    const paid = parseAppConfig({ OFFNAL_ENV: 'development' });
    const betaFree = parseAppConfig({ OFFNAL_ENV: 'development', BILLING_MODE: 'beta_free' });

    expect(paid.billingMode).toBe(BillingMode.PAID);
    expect(isBetaFree(paid)).toBe(false);
    expect(betaFree.billingMode).toBe(BillingMode.BETA_FREE);
    expect(isBetaFree(betaFree)).toBe(true);
  });

  it('blocks paid production with Toss but without Toss keys', () => {
    expect(() => parseAppConfig(withOverrides({ TOSS_CLIENT_KEY: undefined }))).toThrow(
      /PAYMENT_PROVIDER=toss requires TOSS_CLIENT_KEY and TOSS_SECRET_KEY/,
    );
    expect(() => parseAppConfig(withOverrides({ TOSS_SECRET_KEY: undefined }))).toThrow(
      /PAYMENT_PROVIDER=toss requires TOSS_CLIENT_KEY and TOSS_SECRET_KEY/,
    );
    // Unset PAYMENT_PROVIDER resolves to toss in live mode.
    expect(() =>
      parseAppConfig(
        withOverrides({
          BILLING_MODE: 'paid',
          PAYMENT_PROVIDER: undefined,
          TOSS_CLIENT_KEY: undefined,
          TOSS_SECRET_KEY: undefined,
        }),
      ),
    ).toThrow(/PAYMENT_PROVIDER=toss requires TOSS_CLIENT_KEY and TOSS_SECRET_KEY/);
  });

  it('accepts beta_free production without Toss keys', () => {
    const config = parseAppConfig(
      withOverrides({
        BILLING_MODE: 'beta_free',
        PAYMENT_PROVIDER: undefined,
        TOSS_CLIENT_KEY: undefined,
        TOSS_SECRET_KEY: undefined,
      }),
    );

    expect(config.billingMode).toBe(BillingMode.BETA_FREE);
    expect(config.tossClientKey).toBeNull();
  });

  it('still blocks PAYMENT_PROVIDER=mock in beta_free production', () => {
    expect(() =>
      parseAppConfig(
        withOverrides({
          BILLING_MODE: 'beta_free',
          PAYMENT_PROVIDER: 'mock',
          TOSS_CLIENT_KEY: undefined,
          TOSS_SECRET_KEY: undefined,
        }),
      ),
    ).toThrow(/PAYMENT_PROVIDER=mock/);
  });

  it('reads price and free month limit overrides', () => {
    const config = parseAppConfig({ OFFNAL_ENV: 'development', PRICE_KRW: '2500', FREE_MONTH_LIMIT: '3' });

    expect(config.priceKrw).toBe(2500);
    expect(config.freeMonthLimit).toBe(3);
  });

  it('reads Supabase settings, accepting the legacy anon key', () => {
    const withPublishable = parseAppConfig({
      OFFNAL_ENV: 'development',
      NEXT_PUBLIC_SUPABASE_URL: 'https://project-ref.supabase.co/',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'legacy-anon',
    });
    const withAnon = parseAppConfig({
      OFFNAL_ENV: 'development',
      NEXT_PUBLIC_SUPABASE_URL: 'https://project-ref.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'legacy-anon',
    });

    expect(withPublishable.supabaseUrl).toBe('https://project-ref.supabase.co');
    expect(withPublishable.supabasePublishableKey).toBe('sb_publishable_x');
    expect(withAnon.supabasePublishableKey).toBe('legacy-anon');
    expect(parseAppConfig({ OFFNAL_ENV: 'development' })).toMatchObject({
      supabaseUrl: null,
      supabasePublishableKey: null,
    });
  });

  it('defaults live mode to kakao login and demo mode to dev login only', () => {
    expect(parseAppConfig({ OFFNAL_ENV: 'development', APP_MODE: 'live' }).authProviders).toEqual([
      AuthProviderType.KAKAO,
    ]);
    expect(parseAppConfig({ OFFNAL_ENV: 'development', APP_MODE: 'demo' }).authProviders).toEqual([
      AuthProviderType.DEV,
    ]);
  });

  it('rejects a Supabase URL that is not a URL', () => {
    expect(() =>
      parseAppConfig({ OFFNAL_ENV: 'development', NEXT_PUBLIC_SUPABASE_URL: 'not a url' }),
    ).toThrow();
  });

  it('allows a live test deployment with mock recognition and payment in preview and development', () => {
    for (const offnalEnv of [OffnalEnv.PREVIEW, OffnalEnv.DEVELOPMENT]) {
      const config = parseAppConfig(
        withOverrides({
          OFFNAL_ENV: offnalEnv,
          VISION_PROVIDER: 'mock',
          PAYMENT_PROVIDER: 'mock',
          AUTH_PROVIDERS: 'kakao,dev',
        }),
      );

      expect(config).toMatchObject({
        offnalEnv,
        appMode: AppMode.LIVE,
        visionProvider: VisionProviderType.MOCK,
        paymentProvider: PaymentProviderType.MOCK,
        storageDriver: StorageDriver.S3,
        // Dev login stays off in live mode even when requested.
        authProviders: [AuthProviderType.KAKAO],
      });
    }
  });

  it('rejects mock recognition or payment in production live mode', () => {
    expect(() =>
      parseAppConfig(withOverrides({ VISION_PROVIDER: 'mock', PAYMENT_PROVIDER: 'mock' })),
    ).toThrow(/VISION_PROVIDER=mock; PAYMENT_PROVIDER=mock/);
    expect(() => parseAppConfig(withOverrides({ VISION_PROVIDER: 'mock' }))).toThrow(/VISION_PROVIDER=mock/);
    expect(() => parseAppConfig(withOverrides({ PAYMENT_PROVIDER: 'mock' }))).toThrow(
      /PAYMENT_PROVIDER=mock/,
    );
  });

  it('refuses Gemini in production unless the key is declared paid tier', () => {
    expect(() => parseAppConfig(withOverrides({ VISION_PROVIDER: 'gemini' }))).toThrow(
      /VISION_PROVIDER=gemini requires GEMINI_TIER=paid/,
    );
    expect(() => parseAppConfig(withOverrides({ VISION_PROVIDER: 'gemini', GEMINI_TIER: 'free' }))).toThrow(
      /GEMINI_TIER=paid/,
    );

    const config = parseAppConfig(
      withOverrides({ VISION_PROVIDER: 'gemini', GEMINI_TIER: 'paid', GEMINI_API_KEY: 'test-gemini-key' }),
    );

    expect(config).toMatchObject({
      visionProvider: VisionProviderType.GEMINI,
      geminiTier: GeminiTier.PAID,
      geminiApiKey: 'test-gemini-key',
      visionModel: 'gemini-3.7-flash',
    });
  });

  it('allows a free-tier Gemini key outside production and keeps an explicit model', () => {
    const config = parseAppConfig({
      OFFNAL_ENV: 'development',
      VISION_PROVIDER: 'gemini',
      VISION_MODEL: 'gemini-3.8-flash',
    });

    expect(config).toMatchObject({ geminiTier: GeminiTier.FREE, visionModel: 'gemini-3.8-flash' });
    expect(() => parseAppConfig({ OFFNAL_ENV: 'development', GEMINI_TIER: 'trial' })).toThrow();
  });

  it('defaults the second-pass pipeline to warp-strip and accepts the other modes', () => {
    expect(parseAppConfig({ OFFNAL_ENV: 'development' }).visionPipeline).toBe(VisionPipelineMode.WARP_STRIP);
    expect(parseAppConfig({ OFFNAL_ENV: 'development', VISION_PIPELINE: 'baseline' }).visionPipeline).toBe(
      VisionPipelineMode.BASELINE,
    );
    expect(parseAppConfig({ OFFNAL_ENV: 'development', VISION_PIPELINE: 'warp' }).visionPipeline).toBe(
      VisionPipelineMode.WARP,
    );
    expect(() => parseAppConfig({ OFFNAL_ENV: 'development', VISION_PIPELINE: 'strip' })).toThrow();
  });

  it('defaults live deployments to the S3 bucket and demo/test to local files', () => {
    expect(parseAppConfig({ OFFNAL_ENV: 'preview', APP_MODE: 'live' }).storageDriver).toBe(StorageDriver.S3);
    expect(parseAppConfig({ OFFNAL_ENV: 'development', APP_MODE: 'live' }).storageDriver).toBe(
      StorageDriver.S3,
    );
    expect(parseAppConfig({ OFFNAL_ENV: 'development', APP_MODE: 'demo' }).storageDriver).toBe(
      StorageDriver.LOCAL,
    );
    expect(parseAppConfig({ OFFNAL_ENV: 'test', APP_MODE: 'live' }).storageDriver).toBe(StorageDriver.LOCAL);
  });
});
