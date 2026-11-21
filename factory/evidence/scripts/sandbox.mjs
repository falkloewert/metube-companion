import fs from 'node:fs';
import { test as base, expect } from '@playwright/test';

/**
 * Every spec imports `test` from here instead of '@playwright/test'.
 * The auto fixture `sandbox` runs before each test (like a beforeEach) and:
 * - resets the mock MeTube (history, downloads and recorded events back to the seed),
 * - routes card thumbnails (https://i.ytimg.com/**) to the fixture image,
 * - aborts every other request that is not companion or mock MeTube, and fails
 *   the test afterwards if one was attempted (nothing may leave the sandbox).
 */

export const APP_URL = process.env.APP_URL || 'http://web:8080';
export const MOCK_URL = process.env.MOCK_URL || 'http://metube:8081';
const THUMBNAIL_FILE = process.env.THUMBNAIL_FILE || '/fixtures/thumbnail.jpg';

const ALLOWED_ORIGINS = new Set([new URL(APP_URL).origin, new URL(MOCK_URL).origin]);
const THUMBNAIL = fs.readFileSync(THUMBNAIL_FILE);

export { expect };

export const test = base.extend({
  sandbox: [
    async ({ context, request }, use) => {
      const reset = await request.post(`${MOCK_URL}/_mock/reset`);
      expect(reset.ok(), 'POST /_mock/reset').toBeTruthy();

      const blocked = [];
      // Routes registered later win: catch-all first, thumbnails last.
      await context.route('**/*', (route) => {
        const url = route.request().url();
        if (/^(data|blob|about):/.test(url) || ALLOWED_ORIGINS.has(new URL(url).origin)) {
          return route.continue();
        }
        blocked.push(`${route.request().method()} ${url}`);
        return route.abort('blockedbyclient');
      });
      await context.route('https://i.ytimg.com/**', (route) =>
        route.fulfill({ status: 200, contentType: 'image/jpeg', body: THUMBNAIL })
      );

      await use();

      expect(blocked, 'requests that tried to leave the sandbox').toEqual([]);
    },
    { auto: true },
  ],
});
