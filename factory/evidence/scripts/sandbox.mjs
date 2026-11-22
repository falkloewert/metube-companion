// managed by glass-factory kit v1.2.0 (8b5ada6), do not edit; change factory/evidence.config.sh or factory/evidence/tests/
import fs from 'node:fs';
import { test as base, expect } from '@playwright/test';

/**
 * Every spec imports `test` from here instead of '@playwright/test'.
 * The auto fixture `sandbox` runs before each test (like a beforeEach) and:
 * - sends the reset requests of the project (RESET_REQUESTS: mock state, test data back to the seed),
 * - routes the configured fixtures (ROUTED_FIXTURES: external hosts of the page -> local files),
 * - aborts every other request that is not the app, the mock, the inspector or an ALLOWED_ORIGINS entry, and
 *   fails the test afterwards if one was attempted (nothing may leave the sandbox).
 * All values come from factory/evidence.config.sh via run-evidence.sh.
 */

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set; run through factory/evidence/run-evidence.sh`);
  return value;
}

export const APP_URL = required('APP_URL');
export const MOCK_URL = required('MOCK_URL');
// Page of the mock that lists what the app sent (shown in the last proof step).
export const INSPECTOR_URL = process.env.INSPECTOR_URL || MOCK_URL;

const list = (value) => String(value || '').split(';').map((s) => s.trim()).filter(Boolean);

// "METHOD URL; METHOD URL"
const RESETS = list(process.env.RESET_REQUESTS).map((entry) => {
  const [method, ...rest] = entry.split(/\s+/);
  return { method: method.toUpperCase(), url: rest.join(' ') };
});

const CONTENT_TYPES = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.css': 'text/css', '.js': 'text/javascript',
  '.json': 'application/json', '.woff2': 'font/woff2', '.html': 'text/html',
};

// "<url glob> => <file in the evidence container>; ..."; the content type follows the file extension.
const FIXTURES = list(process.env.ROUTED_FIXTURES).map((entry) => {
  const [glob, file] = entry.split(/\s*=>\s*/);
  const ext = file.slice(file.lastIndexOf('.')).toLowerCase();
  return { glob, body: fs.readFileSync(file), contentType: CONTENT_TYPES[ext] || 'application/octet-stream' };
});

const ALLOWED_ORIGINS = new Set(
  [APP_URL, MOCK_URL, INSPECTOR_URL, ...list(process.env.ALLOWED_ORIGINS)].map((u) => new URL(u).origin)
);

export { expect };

export const test = base.extend({
  sandbox: [
    async ({ context, request }, use) => {
      for (const { method, url } of RESETS) {
        const res = await request.fetch(url, { method });
        expect(res.ok(), `${method} ${url}`).toBeTruthy();
      }

      const blocked = [];
      // Routes registered later win: catch-all first, fixtures last.
      await context.route('**/*', (route) => {
        const url = route.request().url();
        if (/^(data|blob|about):/.test(url) || ALLOWED_ORIGINS.has(new URL(url).origin)) {
          return route.continue();
        }
        blocked.push(`${route.request().method()} ${url}`);
        return route.abort('blockedbyclient');
      });
      for (const { glob, body, contentType } of FIXTURES) {
        await context.route(glob, (route) => route.fulfill({ status: 200, contentType, body }));
      }

      await use();

      expect(blocked, 'requests that tried to leave the sandbox').toEqual([]);
    },
    { auto: true },
  ],
});
