import { defineConfig, devices } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * PRD acceptance tests (I-04, §20) against an isolated stack:
 *   API :3200 (test DB) · kiosk core bridge :5285 (fresh SQLite, simulated hardware)
 *   kiosk UI :5284 · admin UI :5283 · customer web app (PWA) http://localhost:3200/ (core in the page) and kiosk management http://localhost:3200/kiosk
 */
const chromiumPath = process.env.PLAYWRIGHT_CHROMIUM_PATH;

/** Dedicated test database: TEST_DATABASE_URL, or DATABASE_URL (env or apps/server/.env) with a `_test` suffix. */
function testDatabaseUrl(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  let base = process.env.DATABASE_URL;
  const envFile = resolve(__dirname, '../apps/server/.env');
  if (!base && existsSync(envFile)) base = /DATABASE_URL="?([^"\n]+)"?/.exec(readFileSync(envFile, 'utf8'))?.[1];
  if (!base) throw new Error('DATABASE_URL / TEST_DATABASE_URL required for E2E');
  const url = new URL(base);
  url.pathname = `${url.pathname.replace(/_test$/, '')}_test`;
  return url.toString();
}
// Shared with the API web server and the test workers (fixtures that need direct DB access).
process.env.E2E_DATABASE_URL = testDatabaseUrl();

export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  outputDir: 'test-results',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'fa-IR',
    timezoneId: 'Asia/Tehran',
    launchOptions: chromiumPath ? { executablePath: chromiumPath } : undefined,
  },
  projects: [
    { name: 'kiosk', testMatch: /kiosk-.*\.spec\.ts/, use: { ...devices['Desktop Chrome'], viewport: { width: 540, height: 960 }, baseURL: 'http://localhost:5284' } },
    { name: 'admin', testMatch: /admin-.*\.spec\.ts/, use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, baseURL: 'http://localhost:5283' } },
    { name: 'webapp', testMatch: /webapp-.*\.spec\.ts/, use: { ...devices['Desktop Chrome'], viewport: { width: 540, height: 960 }, baseURL: 'http://localhost:3200' } },
  ],
  webServer: [
    { command: 'node scripts/start-api.mjs', url: 'http://localhost:3200/api/v1/health', timeout: 180_000, reuseExistingServer: false, stdout: 'ignore', stderr: 'pipe' },
    { command: 'node scripts/start-bridge.mjs', url: 'http://localhost:5285/health', timeout: 120_000, reuseExistingServer: false, stdout: 'ignore', stderr: 'pipe' },
    {
      command: 'npx vite --port 5284 --strictPort',
      cwd: '../apps/kiosk',
      url: 'http://localhost:5284',
      env: { VITE_KIOSK_BRIDGE: 'http://localhost:5285' },
      timeout: 120_000,
      reuseExistingServer: false,
      stdout: 'ignore',
    },
    {
      command: 'npx vite --port 5283 --strictPort',
      cwd: '../apps/admin',
      url: 'http://localhost:5283/admin/',
      env: { VITE_API_URL: 'http://localhost:3200' },
      timeout: 120_000,
      reuseExistingServer: false,
      stdout: 'ignore',
    },
  ],
});
