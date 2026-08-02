import { defineConfig, devices } from '@playwright/test';

import {
  E2E_API_PORT,
  E2E_API_URL,
  E2E_MOCK_OPENAI_PORT,
  E2E_MOCK_OPENAI_URL,
  E2E_WEB_PORT,
  E2E_WEB_URL,
} from './e2e/support/test-environment';

const isCi = Boolean(process.env.CI);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: isCi,
  retries: isCi ? 1 : 0,
  workers: 1,
  timeout: 60_000,
  expect: {
    timeout: 12_000,
  },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  outputDir: 'test-results',
  snapshotPathTemplate: '{testDir}/{testFilePath}-snapshots/{arg}{ext}',
  use: {
    baseURL: E2E_WEB_URL,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    colorScheme: 'dark',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium-desktop',
      testMatch: /.*\.desktop\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: 'chromium-mobile',
      testMatch: /.*\.mobile\.spec\.ts/,
      use: {
        browserName: 'chromium',
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 1,
        hasTouch: true,
        isMobile: true,
      },
    },
  ],
  webServer: [
    {
      command: 'node e2e/support/mock-openai-server.mjs',
      url: `${E2E_MOCK_OPENAI_URL}/health`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        MOCK_OPENAI_HOST: '127.0.0.1',
        MOCK_OPENAI_PORT: E2E_MOCK_OPENAI_PORT,
      },
    },
    {
      command: 'pnpm --filter @werewolf/api... build && pnpm --filter @werewolf/api start',
      url: `${E2E_API_URL}/api/v1/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        API_PORT: E2E_API_PORT,
        CORS_ORIGINS: E2E_WEB_URL,
        DEV_INVITE_CODE: 'E2E-MOONLIT-INVITE',
        NODE_ENV: 'development',
        ADMIN_API_KEY: 'dev-admin-key',
        APP_ENCRYPTION_KEY: '',
        APP_ENCRYPTION_KEY_PREVIOUS: '',
        DATABASE_URL: '',
        KIMI_API_KEY: '',
        DEEPSEEK_API_KEY: '',
        AI_FALLBACK_PROVIDER_IDS: '',
        AI_PROCESS_BUDGET_CENTS: '',
        AI_DAILY_BUDGET_CENTS: '10000',
        AI_MATCH_BUDGET_CENTS: '10000',
        AI_MIN_RESERVATION_CENTS: '1',
        REDIS_URL: '',
        AI_OBSERVER_ACTION_DELAY_MS: '',
        AI_OBSERVER_ROLE_DELAY_MS: '80',
        AI_OBSERVER_NIGHT_DELAY_MS: '900',
        AI_OBSERVER_VOTE_DELAY_MS: '900',
        AI_OBSERVER_SPEECH_DELAY_MS: '1200',
        AI_OBSERVER_SUMMARY_READ_MS: '2500',
      },
    },
    {
      command: `pnpm --filter @werewolf/web build && pnpm --filter @werewolf/web exec next start --hostname localhost --port ${E2E_WEB_PORT}`,
      url: E2E_WEB_URL,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        NEXT_DIST_DIR: '.next-e2e',
        NEXT_PUBLIC_API_URL: E2E_API_URL,
        NEXT_PUBLIC_SOCKET_URL: E2E_API_URL,
      },
    },
  ],
});
