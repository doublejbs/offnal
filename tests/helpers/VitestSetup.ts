import { afterEach } from 'vitest';

import { setSupabaseClientFactoryForTesting } from '@/server/auth/SupabaseServerClient';

// Force an isolated test environment regardless of the developer's shell or .env files.
const TEST_ENV: Record<string, string> = {
  OFFNAL_ENV: 'test',
  APP_MODE: 'demo',
  APP_URL: 'http://localhost:3100',
  APP_SECRET: 'test-secret-test-secret-test-secret-0123456789',
  PGLITE_DIR: 'memory',
  STORAGE_DRIVER: 'local',
  LOCAL_STORAGE_DIR: '.data/storage-test',
  AUTH_PROVIDERS: 'dev',
  VISION_PROVIDER: 'mock',
  PAYMENT_PROVIDER: 'mock',
  MOCK_VISION_DELAY_MS: '0',
  CRON_SECRET: 'test-cron-secret',
};

const CLEARED_KEYS = [
  'DATABASE_URL',
  'S3_ENDPOINT',
  'S3_REGION',
  'S3_BUCKET',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'DATABASE_MIGRATION_URL',
  'DATABASE_SSL_ROOT_CERT',
  'ANTHROPIC_API_KEY',
  'TOSS_CLIENT_KEY',
  'TOSS_SECRET_KEY',
];

for (const key of CLEARED_KEYS) {
  delete process.env[key];
}

Object.assign(process.env, TEST_ENV);

// A fake Supabase client installed by one test must never leak into the next.
afterEach(() => {
  setSupabaseClientFactoryForTesting(null);
});
