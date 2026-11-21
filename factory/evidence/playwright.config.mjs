import path from 'node:path';
import { defineConfig } from '@playwright/test';

const outDir = process.env.EVIDENCE_OUT || path.resolve('./artifacts');

export default defineConfig({
  testDir: './tests',
  forbidOnly: true,
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  outputDir: path.join(outDir, 'test-results'),
  reporter: [
    ['list'],
    ['json', { outputFile: path.join(outDir, 'results.json') }],
  ],
  use: {
    // Service names of docker-compose.factory.yml: the browser runs on the sandbox network.
    baseURL: process.env.APP_URL || 'http://web:8080',
    viewport: { width: 1280, height: 720 },
    // The companion registers a (cache-free) service worker; block it so every request goes through page routing.
    serviceWorkers: 'block',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      // Fast regression suite: records video ONLY on failure to avoid alert fatigue at scale.
      name: 'regression',
      testMatch: /.*regression\.spec\.mjs/,
      use: {
        video: {
          mode: 'retain-on-failure',
          size: { width: 1280, height: 720 },
        },
      },
    },
    {
      // 1 Ticket = 1 Focused Proof Video: human-paced visual proof for reviewers.
      name: 'proof',
      testMatch: /.*proof-flow\.spec\.mjs/,
      timeout: 90_000,
      use: {
        video: {
          mode: 'on',
          size: { width: 1280, height: 720 },
        },
      },
    },
  ],
});
