import path from 'node:path';
import fs from 'node:fs/promises';
import { test, expect, MOCK_URL } from '../scripts/sandbox.mjs';
import {
  createProofSession,
  highlightLocator,
  highlightAndClick,
  humanType,
} from '../scripts/proof-helpers.mjs';

// Proof for #21 (German UI): the same page in an English browser, then with
// German as the browser's first language, a download and a failure in German,
// and the unchanged request to MeTube in the mock inspector.

const OUT_DIR = process.env.EVIDENCE_OUT || path.resolve('./artifacts');
const SCREENSHOT_DIR = path.join(OUT_DIR, 'screenshots');
const SINTEL_URL = 'https://www.youtube.com/watch?v=eRsGyueVLvQ';
const UNKNOWN_URL = 'https://www.youtube.com/watch?v=xxxxxxxxxxx';

test.use({ locale: 'en-US' });

test.beforeAll(async () => {
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
});

test('Level 1 focused proof (#21): English browser, German browser, German download and error, unchanged /add', async ({
  page,
  request,
}) => {
  const TOTAL_STEPS = 5;
  const session = createProofSession(page, { outDir: OUT_DIR, screenshotDir: SCREENSHOT_DIR });
  const cards = page.locator('#done .item');
  const bunny = cards.filter({ hasText: 'Big Buck Bunny' });
  const verb = (card, kind) => card.locator(`.fmt[data-kind="${kind}"] .verb`);

  await page.goto('/');
  await expect(cards).toHaveCount(2);
  await expect(verb(bunny, 'video')).toHaveText('save');
  session.markReady();

  // Step 1/5: English browser, English UI (unchanged default)
  await session.beginStep(1, TOTAL_STEPS, 'English browser: UI in English');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('#done-title')).toHaveText('History');
  await expect(verb(bunny, 'audio')).toHaveText('request');
  await highlightLocator(page, page.locator('#done-title'));
  await highlightLocator(page, bunny.locator('.fmt[data-kind="video"]'));
  await session.finishStep({
    screenshotFile: '01-english-browser.png',
    assertion: 'With browser language en-US the page is lang="en": heading "History", cells "save" / "request"',
  });

  // Step 2/5: German as the browser's first language, reload
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'languages', { get: () => ['de-DE', 'de', 'en'] });
    Object.defineProperty(navigator, 'language', { get: () => 'de-DE' });
  });
  await page.reload();
  await expect(cards).toHaveCount(2);
  await session.beginStep(2, TOTAL_STEPS, 'Browser language German: UI in German');
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  await expect(page.locator('#done-title')).toHaveText('Verlauf');
  await expect(verb(bunny, 'video')).toHaveText('speichern');
  await expect(verb(bunny, 'audio')).toHaveText('anfordern');
  await expect(page.locator('#url')).toHaveAttribute('placeholder', 'Link einfügen');
  await highlightLocator(page, page.locator('#done-title'));
  await highlightLocator(page, bunny.locator('.fmt[data-kind="video"]'));
  await session.finishStep({
    screenshotFile: '02-german-browser.png',
    assertion: 'With German first (de-DE) the same page is lang="de": "Verlauf", "speichern" / "anfordern", field "Link einfügen"; titles stay as they are',
  });

  // Step 3/5: a download in German, from tap to saved
  await session.beginStep(3, TOTAL_STEPS, 'Download in German: tap Audio');
  await humanType(page, page.locator('#url'), SINTEL_URL, { charDelayMs: 28 });
  const audioTile = page.locator('#tiles .tile[data-kind="audio"]');
  await highlightAndClick(page, audioTile);
  await expect(page.locator('#status')).toContainText('Gesendet');
  await expect(audioTile.locator('.ask')).toHaveText('abbrechen?');
  await expect(page.locator('#active-title')).toHaveText('Läuft');
  const running = page.locator('#active .item').filter({ hasText: 'Sintel' });
  await expect(running.locator('.meta')).toContainText(/lädt \d+ %/);
  await highlightLocator(page, running);
  const sintel = cards.filter({ hasText: 'Sintel' });
  await expect(verb(sintel, 'audio')).toHaveText('speichern', { timeout: 20_000 });
  await highlightLocator(page, sintel.locator('.fmt[data-kind="audio"]'));
  await session.finishStep({
    screenshotFile: '03-german-download.png',
    assertion: 'Tile flow, status ("Gesendet.", tile "abbrechen?"), section "Läuft" and progress ("lädt N %") are German; the Sintel audio cell ends as "speichern"',
  });

  // Step 4/5: a failed download explains itself in German
  await session.beginStep(4, TOTAL_STEPS, 'Failed download: reason in German');
  await humanType(page, page.locator('#url'), UNKNOWN_URL, { charDelayMs: 28 });
  const videoTile = page.locator('#tiles .tile[data-kind="video"]');
  await highlightAndClick(page, videoTile);
  const failed = cards.filter({ hasText: 'xxxxxxxxxxx' });
  await expect(failed).toContainText('Das Video ist privat oder nicht verfügbar.', { timeout: 10_000 });
  await highlightLocator(page, failed);
  await session.finishStep({
    screenshotFile: '04-german-error.png',
    assertion: 'An unavailable video fails with the German reason "Das Video ist privat oder nicht verfügbar."',
  });

  // Step 5/5: MeTube got exactly what the English UI sends
  const { events } = await (await request.get(`${MOCK_URL}/_mock/events`)).json();
  const adds = events.filter((e) => e.path === '/add');
  expect(adds).toHaveLength(2);
  expect(adds[0].body).toMatchObject({ url: SINTEL_URL, download_type: 'audio', format: 'm4a', quality: 'best' });
  expect(adds[1].body).toMatchObject({ url: UNKNOWN_URL, download_type: 'video', quality: 'best' });

  await page.goto(`${MOCK_URL}/`);
  await expect(page.locator('h1')).toContainText('Mock MeTube');
  const addRows = page.locator('tr').filter({ hasText: '/add' });
  await expect(addRows).toHaveCount(2);
  await session.beginStep(5, TOTAL_STEPS, 'Mock MeTube: requests unchanged by the language');
  await highlightLocator(page, addRows.filter({ hasText: 'eRsGyueVLvQ' }));
  await session.finishStep({
    screenshotFile: '05-mock-inspector.png',
    assertion: 'Mock MeTube recorded both POST /add with the usual English API values (download_type "audio" / "video", format "m4a"); the language only changes the UI',
    holdEndMs: 2200,
  });

  await session.saveMetadata();
});
