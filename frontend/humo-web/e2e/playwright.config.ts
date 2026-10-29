import { defineConfig, devices } from '@playwright/test';

/**
 * The screen check (docs/28 §1): signs in as each seeded role against the live API and opens every page in its menu.
 * Needs the API (with `seed-demo` loaded and Mailpit for sign-in emails) and `npm run start:api`; CI starts them.
 *   E2E_BASE_URL (default http://localhost:4310) and MAILPIT_URL (default http://localhost:8025).
 */
export default defineConfig({
  testDir: '.',
  testMatch: '*.e2e.ts',
  timeout: 5 * 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: '../playwright-report' }]],
  outputDir: '../test-results',
  use: {
    baseURL: process.env['E2E_BASE_URL'] ?? 'http://localhost:4310',
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
