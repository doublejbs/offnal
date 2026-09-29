import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'mobile-320',
      use: { ...devices['Desktop Chrome'], viewport: { width: 320, height: 720 }, isMobile: false },
    },
    {
      name: 'mobile-390',
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, isMobile: false },
    },
    {
      name: 'tablet-768',
      use: { ...devices['Desktop Chrome'], viewport: { width: 768, height: 1024 }, isMobile: false },
    },
  ],
  webServer: {
    command: `pnpm dev --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180000,
    env: {
      OFFNAL_ENV: 'test',
      APP_MODE: 'demo',
      APP_URL: BASE_URL,
      APP_SECRET: 'e2e-secret-e2e-secret-e2e-secret-0123456789',
      PGLITE_DIR: '.data/pglite-e2e',
      STORAGE_DRIVER: 'local',
      LOCAL_STORAGE_DIR: '.data/storage-e2e',
      AUTH_PROVIDERS: 'dev',
      VISION_PROVIDER: 'mock',
      PAYMENT_PROVIDER: 'mock',
      MOCK_VISION_DELAY_MS: '300',
      CRON_SECRET: 'e2e-cron-secret',
    },
  },
});
