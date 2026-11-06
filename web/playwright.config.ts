import { defineConfig, devices } from '@playwright/test'

const liveURL = 'http://127.0.0.1:5178'
const staticURL = 'http://127.0.0.1:5179/lakehouse-copilot/'

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results/runs',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  // Keep local verification within the shared 16 GB development host's budget.
  // Two isolated browser workers let the repeated Linux CI journeys finish.
  workers: process.env.CI ? 2 : 1,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['json', { outputFile: 'test-results/results.json' }],
  ],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    reducedMotion: 'reduce',
    timezoneId: 'UTC',
    locale: 'en-GB',
  },
  projects: [
    {
      name: 'published-desktop',
      testMatch: /published-current\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 1000 },
        baseURL: 'http://127.0.0.1:5180/lakehouse-copilot/',
      },
    },
    {
      name: 'published-mobile',
      testMatch: /published-current\.spec\.ts/,
      use: { ...devices['Pixel 7'], baseURL: 'http://127.0.0.1:5180/lakehouse-copilot/' },
    },
    {
      name: 'live-desktop',
      testMatch:
        /(?:live|domain|openfootball|worldcup-team|research-groups|live-workspace|live-chat)\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 1000 },
        baseURL: liveURL,
      },
    },
    {
      name: 'static-desktop',
      testMatch:
        /(?:static|domain|openfootball|worldcup-team|research-groups|live-workspace|live-chat)\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 1000 },
        baseURL: staticURL,
      },
    },
    {
      name: 'static-mobile',
      testMatch:
        /(?:static|domain|openfootball|worldcup-team|research-groups|live-workspace|live-chat)\.spec\.ts/,
      use: { ...devices['Pixel 7'], baseURL: staticURL },
    },
  ],
  webServer: [
    {
      command: 'node tests/start-published.mjs',
      url: 'http://127.0.0.1:5180/lakehouse-copilot/',
      reuseExistingServer: false,
      timeout: 60000,
    },
    {
      command: 'node tests/start-api.mjs',
      url: 'http://127.0.0.1:8765/health',
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'npm run dev -- --port 5178',
      url: liveURL,
      env: {
        VITE_API_BASE: '/api',
        VITE_API_PROXY_TARGET: 'http://127.0.0.1:8765',
        VITE_STATIC_DEMO: 'false',
      },
      stdout: 'pipe',
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'node tests/start-static.mjs',
      url: staticURL,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
})
