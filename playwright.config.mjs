import { defineConfig } from '@playwright/test';

const isCI = !!process.env.CI;

export default defineConfig({
  testDir: 'tests/e2e',
  // Bound test and assertion waits so stalled browser actions fail promptly.
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  // Fail the build if a focused test.only is left in the suite.
  forbidOnly: isCI,
  // CI retries capture a trace; local runs report failures immediately.
  retries: isCI ? 2 : 0,
  reporter: isCI ? [['github'], ['list']] : [['list']],
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure'
  }
});
