import { z } from 'zod';

import { AppMode } from '@/domain/enums/AppMode';
import { AuthProviderType } from '@/domain/enums/AuthProviderType';
import { OffnalEnv } from '@/domain/enums/OffnalEnv';
import { PaymentProviderType } from '@/domain/enums/PaymentProviderType';
import { StorageDriver } from '@/domain/enums/StorageDriver';
import { VisionEffort } from '@/domain/enums/VisionEffort';
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
  googleClientId: string | null;
  googleClientSecret: string | null;
  visionProvider: VisionProviderType;
  anthropicApiKey: string | null;
  visionModel: string;
  visionEffort: VisionEffort;
  visionTimeoutMs: number;
  mockVisionDelayMs: number;
  paymentProvider: PaymentProviderType;
  tossClientKey: string | null;
  tossSecretKey: string | null;
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
  sourceTtlHours: number;
  draftTtlDays: number;
  cronSecret: string | null;
};

type RawEnv = Record<string, string | undefined>;

export const MIN_APP_SECRET_LENGTH = 32;

const DEFAULT_APP_URL = 'http://localhost:3000';
const DEVELOPMENT_APP_SECRET = 'offnal-development-only-secret-do-not-use-in-production';
const DEFAULT_VISION_MODEL = 'claude-opus-5-5';

export const DEFAULT_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;

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
  GOOGLE_CLIENT_ID: optionalText,
  GOOGLE_CLIENT_SECRET: optionalText,
  VISION_PROVIDER: z.enum(VisionProviderType).optional(),
  ANTHROPIC_API_KEY: optionalText,
  VISION_MODEL: z.string().default(DEFAULT_VISION_MODEL),
  VISION_EFFORT: z.enum(VisionEffort).default(VisionEffort.MEDIUM),
  VISION_TIMEOUT_MS: positiveInt(240_000),
  MOCK_VISION_DELAY_MS: nonNegativeInt(1200),
  PAYMENT_PROVIDER: z.enum(PaymentProviderType).optional(),
  TOSS_CLIENT_KEY: optionalText,
  TOSS_SECRET_KEY: optionalText,
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
  SOURCE_TTL_HOURS: positiveInt(24),
  DRAFT_TTL_DAYS: positiveInt(30),
  CRON_SECRET: optionalText,
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

const collectProductionViolations = (
  parsed: ParsedEnv,
  appMode: AppMode,
  storageDriver: StorageDriver,
): string[] => {
  const violations: string[] = [];
  const visionProvider =
    parsed.VISION_PROVIDER ?? (appMode === AppMode.DEMO ? VisionProviderType.MOCK : null);
  const paymentProvider =
    parsed.PAYMENT_PROVIDER ?? (appMode === AppMode.DEMO ? PaymentProviderType.MOCK : null);

  if (appMode === AppMode.DEMO) {
    violations.push('APP_MODE=demo');
  }

  if (visionProvider === VisionProviderType.MOCK) {
    violations.push('VISION_PROVIDER=mock');
  }

  if (paymentProvider === PaymentProviderType.MOCK) {
    violations.push('PAYMENT_PROVIDER=mock');
  }

  if (parsed.AUTH_PROVIDERS?.includes(AuthProviderType.DEV)) {
    violations.push('AUTH_PROVIDERS includes dev');
  }

  if (storageDriver === StorageDriver.LOCAL) {
    violations.push('STORAGE_DRIVER=local');
  }

  if (!parsed.DATABASE_URL) {
    violations.push('DATABASE_URL is required (PGlite is not allowed)');
  }

  if (!parsed.APP_SECRET || parsed.APP_SECRET.length < MIN_APP_SECRET_LENGTH) {
    violations.push(`APP_SECRET must be at least ${MIN_APP_SECRET_LENGTH} characters`);
  }

  if (!parsed.APP_URL) {
    violations.push('APP_URL is required');
  } else if (new URL(parsed.APP_URL).protocol !== 'https:') {
    violations.push('APP_URL must use https://');
  }

  return violations;
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
  const storageDriver =
    parsed.STORAGE_DRIVER ?? (isDemo || !isProduction ? StorageDriver.LOCAL : StorageDriver.S3);

  if (isProduction) {
    const violations = collectProductionViolations(parsed, appMode, storageDriver);

    if (violations.length > 0) {
      throw new Error(`Unsafe production configuration: ${violations.join('; ')}`);
    }
  }

  const defaultAuthProviders = isDemo ? [AuthProviderType.DEV] : [AuthProviderType.GOOGLE];

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
    authProviders: resolveAuthProviders(parsed.AUTH_PROVIDERS ?? defaultAuthProviders, appMode),
    googleClientId: parsed.GOOGLE_CLIENT_ID ?? null,
    googleClientSecret: parsed.GOOGLE_CLIENT_SECRET ?? null,
    visionProvider:
      parsed.VISION_PROVIDER ?? (isDemo ? VisionProviderType.MOCK : VisionProviderType.ANTHROPIC),
    anthropicApiKey: parsed.ANTHROPIC_API_KEY ?? null,
    visionModel: parsed.VISION_MODEL,
    visionEffort: parsed.VISION_EFFORT,
    visionTimeoutMs: parsed.VISION_TIMEOUT_MS,
    mockVisionDelayMs: parsed.MOCK_VISION_DELAY_MS,
    paymentProvider:
      parsed.PAYMENT_PROVIDER ?? (isDemo ? PaymentProviderType.MOCK : PaymentProviderType.TOSS),
    tossClientKey: parsed.TOSS_CLIENT_KEY ?? null,
    tossSecretKey: parsed.TOSS_SECRET_KEY ?? null,
    priceKrw: parsed.PRICE_KRW,
    freeMonthLimit: parsed.FREE_MONTH_LIMIT,
    uploadMaxBytes: parsed.UPLOAD_MAX_BYTES,
    uploadMaxPixels: parsed.UPLOAD_MAX_PIXELS,
    rateLimitAnonDaily: parsed.RATE_LIMIT_ANON_DAILY,
    rateLimitIpDaily: parsed.RATE_LIMIT_IP_DAILY,
    rateLimitUserDaily: parsed.RATE_LIMIT_USER_DAILY,
    extractLimitUserMonthly: parsed.EXTRACT_LIMIT_USER_MONTHLY,
    rateLimitSharedIpDaily: parsed.RATE_LIMIT_SHARED_IP_DAILY,
    sourceTtlHours: parsed.SOURCE_TTL_HOURS,
    draftTtlDays: parsed.DRAFT_TTL_DAYS,
    cronSecret: parsed.CRON_SECRET ?? null,
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
