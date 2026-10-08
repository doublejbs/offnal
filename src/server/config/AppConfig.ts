import 'server-only';

import { z } from 'zod';

import { AnalyticsSink } from '@/domain/enums/AnalyticsSink';
import { AppMode } from '@/domain/enums/AppMode';
import { AuthProviderType } from '@/domain/enums/AuthProviderType';
import { BillingMode } from '@/domain/enums/BillingMode';
import { GeminiTier } from '@/domain/enums/GeminiTier';
import { OcrMode } from '@/domain/enums/OcrMode';
import { OffnalEnv } from '@/domain/enums/OffnalEnv';
import { PaymentProviderType } from '@/domain/enums/PaymentProviderType';
import { StorageDriver } from '@/domain/enums/StorageDriver';
import { VisionEffort } from '@/domain/enums/VisionEffort';
import { VisionPipelineMode } from '@/domain/enums/VisionPipelineMode';
import { VisionProviderType } from '@/domain/enums/VisionProviderType';
import { DEFAULT_FREE_MONTH_LIMIT, DEFAULT_PRICE_KRW } from '@/server/config/PricingConfig';

export type AppConfig = {
  offnalEnv: OffnalEnv;
  appMode: AppMode;
  appUrl: string;
  appSecret: string;
  databaseUrl: string | null;
  pgliteDir: string;
  storageDriver: StorageDriver;
  localStorageDir: string;
  s3Endpoint: string | null;
  s3Region: string;
  s3Bucket: string | null;
  s3AccessKeyId: string | null;
  s3SecretAccessKey: string | null;
  /** Enabled login providers. `dev` is present only (and always) in demo mode. */
  authProviders: AuthProviderType[];
  /** Supabase project URL (`https://<ref>.supabase.co`, public). Null when Supabase Auth is not set up. */
  supabaseUrl: string | null;
  /** Publishable (or legacy anon) key: public by design, grants nothing because RLS blocks every table. */
  supabasePublishableKey: string | null;
  visionProvider: VisionProviderType;
  anthropicApiKey: string | null;
  geminiApiKey: string | null;
  /** Billing tier of the Gemini key. Production refuses Gemini unless this is `paid`. */
  geminiTier: GeminiTier;
  visionModel: string;
  visionEffort: VisionEffort;
  visionTimeoutMs: number;
  /** Second-pass input pipeline (Spec §15). */
  visionPipeline: VisionPipelineMode;
  mockVisionDelayMs: number;
  /** AI-free OCR in the service (Spec §22). Always `off` in demo mode and automated tests. */
  ocrMode: OcrMode;
  /** Share (0–1) of eligible extracts that get a shadow OCR run. */
  ocrShadowSampleRate: number;
  ocrTimeoutMs: number;
  paymentProvider: PaymentProviderType;
  tossClientKey: string | null;
  tossSecretKey: string | null;
  /** `beta_free` opens every month without payment and hides pricing (Spec §20). */
  billingMode: BillingMode;
  priceKrw: number;
  freeMonthLimit: number;
  uploadMaxBytes: number;
  uploadMaxPixels: number;
  rateLimitAnonDaily: number;
  rateLimitIpDaily: number;
  rateLimitUserDaily: number;
  extractLimitUserMonthly: number;
  /** Public share link views per IP per day (slows token guessing; tokens are 256-bit anyway). */
  rateLimitSharedIpDaily: number;
  /** Payment webhook deliveries per IP per day (generous: all events come from a few provider IPs). */
  rateLimitWebhookIpDaily: number;
  sourceTtlHours: number;
  draftTtlDays: number;
  cronSecret: string | null;
  /** Where usage events go (Spec §23.2). Never `db` in demo mode; `off` in tests unless set explicitly. */
  analyticsSink: AnalyticsSink;
};

type RawEnv = Record<string, string | undefined>;

export const MIN_APP_SECRET_LENGTH = 32;
export const MIN_CRON_SECRET_LENGTH = 32;
/** The `.env.example` value; must never reach production. */
export const CRON_SECRET_PLACEHOLDER = 'change-me-cron-secret';

const DEFAULT_APP_URL = 'http://localhost:3000';
const DEVELOPMENT_APP_SECRET = 'offnal-development-only-secret-do-not-use-in-production';
const DEFAULT_VISION_MODEL = 'claude-opus-5-5';
const DEFAULT_GEMINI_VISION_MODEL = 'gemini-3.7-flash';

export const DEFAULT_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;
export const DEFAULT_OCR_SHADOW_SAMPLE_RATE = 0.3;
export const MAX_OCR_TIMEOUT_MS = 120_000;

const optionalText = z.string().optional();
const positiveInt = (defaultValue: number) => z.coerce.number().int().positive().default(defaultValue);
const nonNegativeInt = (defaultValue: number) => z.coerce.number().int().nonnegative().default(defaultValue);

const envSchema = z.object({
  OFFNAL_ENV: z.enum(OffnalEnv).optional(),
  APP_MODE: z.enum(AppMode).optional(),
  APP_URL: z.url().optional(),
  APP_SECRET: optionalText,
  DATABASE_URL: optionalText,
  PGLITE_DIR: z.string().default('.data/pglite'),
  STORAGE_DRIVER: z.enum(StorageDriver).optional(),
  LOCAL_STORAGE_DIR: z.string().default('.data/storage'),
  S3_ENDPOINT: z.url().optional(),
  S3_REGION: z.string().default('ap-northeast-2'),
  S3_BUCKET: optionalText,
  S3_ACCESS_KEY_ID: optionalText,
  S3_SECRET_ACCESS_KEY: optionalText,
  AUTH_PROVIDERS: z
    .string()
    .transform((value) =>
      value
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    )
    .pipe(z.array(z.enum(AuthProviderType)))
    .optional(),
  NEXT_PUBLIC_SUPABASE_URL: z.url().optional(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: optionalText,
  /** Legacy name of the same public key (projects created before publishable keys). */
  NEXT_PUBLIC_SUPABASE_ANON_KEY: optionalText,
  VISION_PROVIDER: z.enum(VisionProviderType).optional(),
  ANTHROPIC_API_KEY: optionalText,
  GEMINI_API_KEY: optionalText,
  GEMINI_TIER: z.enum(GeminiTier).default(GeminiTier.FREE),
  /** Default depends on the provider (Claude or Gemini model id). */
  VISION_MODEL: optionalText,
  VISION_EFFORT: z.enum(VisionEffort).default(VisionEffort.MEDIUM),
  VISION_TIMEOUT_MS: positiveInt(240_000),
  VISION_PIPELINE: z.enum(VisionPipelineMode).default(VisionPipelineMode.WARP_STRIP),
  MOCK_VISION_DELAY_MS: nonNegativeInt(1200),
  OCR_MODE: z.enum(OcrMode).default(OcrMode.OFF),
  // normalizeEnv converts empty strings to undefined, so an empty value means the default.
  OCR_SHADOW_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(DEFAULT_OCR_SHADOW_SAMPLE_RATE),
  // Also capped by the extract route's remaining maxDuration at run time (Spec §22-9).
  OCR_TIMEOUT_MS: z.coerce.number().int().positive().max(MAX_OCR_TIMEOUT_MS).default(60_000),
  PAYMENT_PROVIDER: z.enum(PaymentProviderType).optional(),
  TOSS_CLIENT_KEY: optionalText,
  TOSS_SECRET_KEY: optionalText,
  BILLING_MODE: z.enum(BillingMode).default(BillingMode.PAID),
  PRICE_KRW: positiveInt(DEFAULT_PRICE_KRW),
  FREE_MONTH_LIMIT: nonNegativeInt(DEFAULT_FREE_MONTH_LIMIT),
  // Vercel function request bodies are limited to ~4.5MB; the UI downscales photos before upload.
  UPLOAD_MAX_BYTES: positiveInt(DEFAULT_UPLOAD_MAX_BYTES),
  UPLOAD_MAX_PIXELS: positiveInt(40_000_000),
  RATE_LIMIT_ANON_DAILY: positiveInt(5),
  RATE_LIMIT_IP_DAILY: positiveInt(20),
  RATE_LIMIT_USER_DAILY: positiveInt(20),
  EXTRACT_LIMIT_USER_MONTHLY: positiveInt(30),
  RATE_LIMIT_SHARED_IP_DAILY: positiveInt(300),
  RATE_LIMIT_WEBHOOK_IP_DAILY: positiveInt(5000),
  SOURCE_TTL_HOURS: positiveInt(24),
  DRAFT_TTL_DAYS: positiveInt(30),
  CRON_SECRET: optionalText,
  ANALYTICS_SINK: z.enum(AnalyticsSink).optional(),
});

type ParsedEnv = z.infer<typeof envSchema>;

/** Treats blank values (e.g. `DATABASE_URL=` in .env files) as unset. */
const normalizeEnv = (env: RawEnv): RawEnv =>
  Object.fromEntries(
    Object.entries(env).map(([key, value]) => {
      const trimmed = value?.trim();

      return [key, trimmed === '' ? undefined : trimmed];
    }),
  );

const resolveOffnalEnv = (parsed: ParsedEnv, env: RawEnv): OffnalEnv => {
  if (parsed.OFFNAL_ENV) {
    return parsed.OFFNAL_ENV;
  }

  // Unset OFFNAL_ENV falls back to NODE_ENV so a production build never silently runs as development.
  return env.NODE_ENV === 'production' ? OffnalEnv.PRODUCTION : OffnalEnv.DEVELOPMENT;
};

const resolveAuthProviders = (requested: AuthProviderType[], appMode: AppMode): AuthProviderType[] => {
  const withoutDev = [...new Set(requested)].filter((provider) => provider !== AuthProviderType.DEV);

  if (appMode === AppMode.DEMO) {
    return [...withoutDev, AuthProviderType.DEV];
  }

  return withoutDev;
};

const readSupabasePublishableKey = (parsed: ParsedEnv): string | null =>
  parsed.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? parsed.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? null;

const hasSupabaseAuth = (parsed: ParsedEnv): boolean =>
  Boolean(parsed.NEXT_PUBLIC_SUPABASE_URL && readSupabasePublishableKey(parsed));

const collectProductionViolations = (
  parsed: ParsedEnv,
  appMode: AppMode,
  storageDriver: StorageDriver,
  authProviders: AuthProviderType[],
): string[] => {
  const violations: string[] = [];
  const visionProvider =
    parsed.VISION_PROVIDER ?? (appMode === AppMode.DEMO ? VisionProviderType.MOCK : null);
  const paymentProvider =
    parsed.PAYMENT_PROVIDER ??
    (appMode === AppMode.DEMO ? PaymentProviderType.MOCK : PaymentProviderType.TOSS);

  if (appMode === AppMode.DEMO) {
    violations.push('APP_MODE=demo');
  }

  if (visionProvider === VisionProviderType.MOCK) {
    violations.push('VISION_PROVIDER=mock');
  }

  // Free-tier Gemini keys may use prompts and images to improve Google products: never for real users.
  if (visionProvider === VisionProviderType.GEMINI && parsed.GEMINI_TIER !== GeminiTier.PAID) {
    violations.push('VISION_PROVIDER=gemini requires GEMINI_TIER=paid');
  }

  if (paymentProvider === PaymentProviderType.MOCK) {
    violations.push('PAYMENT_PROVIDER=mock');
  }

  // Beta free mode never builds a payment provider, so it is the only way to run production without Toss keys.
  if (
    parsed.BILLING_MODE === BillingMode.PAID &&
    paymentProvider === PaymentProviderType.TOSS &&
    (!parsed.TOSS_CLIENT_KEY || !parsed.TOSS_SECRET_KEY)
  ) {
    violations.push(
      'PAYMENT_PROVIDER=toss (or unset) requires TOSS_CLIENT_KEY and TOSS_SECRET_KEY (or BILLING_MODE=beta_free)',
    );
  }

  if (parsed.AUTH_PROVIDERS?.includes(AuthProviderType.DEV)) {
    violations.push('AUTH_PROVIDERS includes dev');
  }

  if (storageDriver === StorageDriver.LOCAL) {
    violations.push('STORAGE_DRIVER=local');
  } else if (!parsed.S3_BUCKET || !parsed.S3_ACCESS_KEY_ID || !parsed.S3_SECRET_ACCESS_KEY) {
    violations.push('STORAGE_DRIVER=s3 requires S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY');
  }

  if (authProviders.includes(AuthProviderType.KAKAO) && !hasSupabaseAuth(parsed)) {
    violations.push(
      'kakao login requires NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or _ANON_KEY)',
    );
  }

  if (!parsed.DATABASE_URL) {
    violations.push('DATABASE_URL is required (PGlite is not allowed)');
  }

  if (!parsed.APP_SECRET || parsed.APP_SECRET.length < MIN_APP_SECRET_LENGTH) {
    violations.push(`APP_SECRET must be at least ${MIN_APP_SECRET_LENGTH} characters`);
  }

  // Unset CRON_SECRET only disables the cleanup endpoint (503); a set one must be strong.
  if (
    parsed.CRON_SECRET &&
    (parsed.CRON_SECRET === CRON_SECRET_PLACEHOLDER || parsed.CRON_SECRET.length < MIN_CRON_SECRET_LENGTH)
  ) {
    violations.push(
      `CRON_SECRET must be at least ${MIN_CRON_SECRET_LENGTH} characters and not the example value`,
    );
  }

  if (!parsed.APP_URL) {
    violations.push('APP_URL is required');
  } else if (new URL(parsed.APP_URL).protocol !== 'https:') {
    violations.push('APP_URL must use https://');
  }

  return violations;
};

/**
 * Spec §23.2: development logs to the console, tests are off, preview/production store in the DB. Demo
 * data is never stored (db → console). Tests may opt in explicitly (integration tests with sink=db).
 */
const resolveAnalyticsSink = (
  requested: AnalyticsSink | undefined,
  offnalEnv: OffnalEnv,
  appMode: AppMode,
): AnalyticsSink => {
  if (offnalEnv === OffnalEnv.TEST) {
    return requested ?? AnalyticsSink.OFF;
  }

  const sink = requested ?? (offnalEnv === OffnalEnv.DEVELOPMENT ? AnalyticsSink.CONSOLE : AnalyticsSink.DB);

  if (appMode === AppMode.DEMO && sink === AnalyticsSink.DB) {
    return AnalyticsSink.CONSOLE;
  }

  return sink;
};

/** Parses and validates environment variables. Throws on invalid values or unsafe production settings. */
export const parseAppConfig = (rawEnv: RawEnv): AppConfig => {
  const env = normalizeEnv(rawEnv);
  const result = envSchema.safeParse(env);

  if (!result.success) {
    const fields = result.error.issues.map((issue) => issue.path.join('.')).join(', ');

    throw new Error(`Invalid environment configuration: ${fields}`);
  }

  const parsed = result.data;
  const offnalEnv = resolveOffnalEnv(parsed, env);
  const isProduction = offnalEnv === OffnalEnv.PRODUCTION;
  const appMode = parsed.APP_MODE ?? (isProduction ? AppMode.LIVE : AppMode.DEMO);
  const isDemo = appMode === AppMode.DEMO;
  // Live deployments (development/preview/production) default to the Supabase bucket: a serverless
  // filesystem is read-only/ephemeral. Only demo mode and automated tests default to local files.
  const storageDriver =
    parsed.STORAGE_DRIVER ??
    (isDemo || offnalEnv === OffnalEnv.TEST ? StorageDriver.LOCAL : StorageDriver.S3);

  const defaultAuthProviders = isDemo ? [AuthProviderType.DEV] : [AuthProviderType.KAKAO];
  const authProviders = resolveAuthProviders(parsed.AUTH_PROVIDERS ?? defaultAuthProviders, appMode);
  const visionProvider =
    parsed.VISION_PROVIDER ?? (isDemo ? VisionProviderType.MOCK : VisionProviderType.ANTHROPIC);
  const defaultVisionModel =
    visionProvider === VisionProviderType.GEMINI ? DEFAULT_GEMINI_VISION_MODEL : DEFAULT_VISION_MODEL;

  if (isProduction) {
    const violations = collectProductionViolations(parsed, appMode, storageDriver, authProviders);

    if (violations.length > 0) {
      throw new Error(`Unsafe production configuration: ${violations.join('; ')}`);
    }
  }

  return {
    offnalEnv,
    appMode,
    appUrl: new URL(parsed.APP_URL ?? DEFAULT_APP_URL).origin,
    appSecret: parsed.APP_SECRET ?? DEVELOPMENT_APP_SECRET,
    databaseUrl: parsed.DATABASE_URL ?? null,
    pgliteDir: parsed.PGLITE_DIR,
    storageDriver,
    localStorageDir: parsed.LOCAL_STORAGE_DIR,
    s3Endpoint: parsed.S3_ENDPOINT ?? null,
    s3Region: parsed.S3_REGION,
    s3Bucket: parsed.S3_BUCKET ?? null,
    s3AccessKeyId: parsed.S3_ACCESS_KEY_ID ?? null,
    s3SecretAccessKey: parsed.S3_SECRET_ACCESS_KEY ?? null,
    authProviders,
    supabaseUrl: parsed.NEXT_PUBLIC_SUPABASE_URL ? new URL(parsed.NEXT_PUBLIC_SUPABASE_URL).origin : null,
    supabasePublishableKey: readSupabasePublishableKey(parsed),
    visionProvider,
    anthropicApiKey: parsed.ANTHROPIC_API_KEY ?? null,
    geminiApiKey: parsed.GEMINI_API_KEY ?? null,
    geminiTier: parsed.GEMINI_TIER,
    visionModel: parsed.VISION_MODEL ?? defaultVisionModel,
    visionEffort: parsed.VISION_EFFORT,
    visionTimeoutMs: parsed.VISION_TIMEOUT_MS,
    visionPipeline: parsed.VISION_PIPELINE,
    mockVisionDelayMs: parsed.MOCK_VISION_DELAY_MS,
    // Demo data and test runs never start the OCR engine (no downloads, no worker threads).
    ocrMode: isDemo || offnalEnv === OffnalEnv.TEST ? OcrMode.OFF : parsed.OCR_MODE,
    ocrShadowSampleRate: parsed.OCR_SHADOW_SAMPLE_RATE,
    ocrTimeoutMs: parsed.OCR_TIMEOUT_MS,
    paymentProvider:
      parsed.PAYMENT_PROVIDER ?? (isDemo ? PaymentProviderType.MOCK : PaymentProviderType.TOSS),
    tossClientKey: parsed.TOSS_CLIENT_KEY ?? null,
    tossSecretKey: parsed.TOSS_SECRET_KEY ?? null,
    billingMode: parsed.BILLING_MODE,
    priceKrw: parsed.PRICE_KRW,
    freeMonthLimit: parsed.FREE_MONTH_LIMIT,
    uploadMaxBytes: parsed.UPLOAD_MAX_BYTES,
    uploadMaxPixels: parsed.UPLOAD_MAX_PIXELS,
    rateLimitAnonDaily: parsed.RATE_LIMIT_ANON_DAILY,
    rateLimitIpDaily: parsed.RATE_LIMIT_IP_DAILY,
    rateLimitUserDaily: parsed.RATE_LIMIT_USER_DAILY,
    extractLimitUserMonthly: parsed.EXTRACT_LIMIT_USER_MONTHLY,
    rateLimitSharedIpDaily: parsed.RATE_LIMIT_SHARED_IP_DAILY,
    rateLimitWebhookIpDaily: parsed.RATE_LIMIT_WEBHOOK_IP_DAILY,
    sourceTtlHours: parsed.SOURCE_TTL_HOURS,
    draftTtlDays: parsed.DRAFT_TTL_DAYS,
    cronSecret: parsed.CRON_SECRET ?? null,
    analyticsSink: resolveAnalyticsSink(parsed.ANALYTICS_SINK, offnalEnv, appMode),
  };
};

type ConfigGlobal = typeof globalThis & { __offnalAppConfig?: AppConfig };

const configGlobal = globalThis as ConfigGlobal;

/** Process-wide config parsed from `process.env` (cached). */
export const getAppConfig = (): AppConfig => {
  if (!configGlobal.__offnalAppConfig) {
    configGlobal.__offnalAppConfig = parseAppConfig(process.env);
  }

  return configGlobal.__offnalAppConfig;
};

/** Drops the cached config so the next `getAppConfig` re-reads `process.env`. Tests only. */
export const resetAppConfigForTesting = (): void => {
  configGlobal.__offnalAppConfig = undefined;
};

export const isDemoMode = (): boolean => getAppConfig().appMode === AppMode.DEMO;
