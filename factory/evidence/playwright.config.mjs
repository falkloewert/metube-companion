// managed by glass-factory kit v1.2.0 (8b5ada6), do not edit; change factory/evidence.config.sh or factory/evidence/tests/
import path from 'node:path';
import { defineConfig } from '@playwright/test';

// Values come from factory/evidence.config.sh via run-evidence.sh (see README, "Config reference").
const outDir = process.env.EVIDENCE_OUT || path.resolve('./artifacts');
const timeoutMs = Number(process.env.PW_TIMEOUT_MS || 45_000);
const proofTimeoutMs = Number(process.env.PW_PROOF_TIMEOUT_MS || timeoutMs);

export default defineConfig({
  testDir: './tests',
  forbidOnly: true,
  timeout: timeoutMs,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  outputDir: path.join(outDir, 'test-results'),
  reporter: [
    ['list'],
    ['json', { outputFile: path.join(outDir, 'results.json') }],
  ],
  use: {
    // Service name of the sandbox network, e.g. http://web:8080 (the browser runs inside it).
    baseURL: process.env.APP_URL,
    viewport: { width: 1280, height: 720 },
    // Block service workers so every request goes through context routing (sandbox network block, fixtures).
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
      timeout: proofTimeoutMs,
      use: {
        video: {
          mode: 'on',
          size: { width: 1280, height: 720 },
        },
      },
    },
  ],
});
