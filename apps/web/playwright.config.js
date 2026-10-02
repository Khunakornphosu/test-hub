import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: { ...devices['Desktop Chrome'], baseURL: process.env.WEB_URL || 'http://localhost:4700', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
});
