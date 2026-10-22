import { defineConfig } from '@playwright/test';

if (!process.env.SEALOG_DOCKER_URL) {
  throw new Error('Run Docker tests with npm run test:docker to start the containers and API fixtures.');
}

export default defineConfig({
  testDir: 'tests/docker',
  testMatch: '*.spec.mjs',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  outputDir: `test-results/docker-${process.env.SEALOG_DOCKER_MODE}`,
  use: {
    baseURL: process.env.SEALOG_DOCKER_URL,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure'
  }
});
