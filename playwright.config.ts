import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;
const BASE_URL = `http://localhost:${PORT}`;
const PGLITE_DIR = '.data/pglite-e2e';
const STORAGE_DIR = '.data/storage-e2e';
// Every run starts from an empty DB and storage (removed before the server opens them).
const CLEAN_COMMAND = `node -e "for (const dir of ['${PGLITE_DIR}', '${STORAGE_DIR}']) require('node:fs').rmSync(dir, { recursive: true, force: true })"`;
/** Responsive checks run at every width; the flow specs run once at 390px. */
const RESPONSIVE_ONLY = /Responsive\.spec\.ts/;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'mobile-320',
      testMatch: RESPONSIVE_ONLY,
      use: { ...devices['Desktop Chrome'], viewport: { width: 320, height: 720 }, isMobile: false },
    },
    {
      name: 'mobile-390',
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, isMobile: false },
    },
    {
      name: 'tablet-768',
      testMatch: RESPONSIVE_ONLY,
      use: { ...devices['Desktop Chrome'], viewport: { width: 768, height: 1024 }, isMobile: false },
    },
  ],
  webServer: {
    command: `${CLEAN_COMMAND} && pnpm dev --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 180000,
    // Explicitly blank every real-provider credential so E2E can never reach live services.
    env: {
      OFFNAL_ENV: 'test',
      APP_MODE: 'demo',
      APP_URL: BASE_URL,
      APP_SECRET: 'e2e-only-secret-not-for-production-0123456789',
      DATABASE_URL: '',
      PGLITE_DIR,
      STORAGE_DRIVER: 'local',
      LOCAL_STORAGE_DIR: STORAGE_DIR,
      S3_ENDPOINT: '',
      S3_REGION: '',
      S3_BUCKET: '',
      S3_ACCESS_KEY_ID: '',
      S3_SECRET_ACCESS_KEY: '',
      AUTH_PROVIDERS: 'dev',
      GOOGLE_CLIENT_ID: '',
      GOOGLE_CLIENT_SECRET: '',
      VISION_PROVIDER: 'mock',
      ANTHROPIC_API_KEY: '',
      MOCK_VISION_DELAY_MS: '300',
      // Every E2E request comes from one IP: keep per-session/per-user limits, lift the shared IP ones.
      RATE_LIMIT_IP_DAILY: '10000',
      RATE_LIMIT_SHARED_IP_DAILY: '10000',
      RATE_LIMIT_EVENTS_IP_DAILY: '10000',
      PAYMENT_PROVIDER: 'mock',
      TOSS_CLIENT_KEY: '',
      TOSS_SECRET_KEY: '',
      CRON_SECRET: 'e2e-cron-secret',
    },
  },
});
