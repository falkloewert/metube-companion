import path from 'node:path';
import fs from 'node:fs/promises';
import { test, expect, MOCK_URL } from '../scripts/sandbox.mjs';
import {
  createProofSession,
  highlightLocator,
  highlightAndClick,
  humanType,
} from '../scripts/proof-helpers.mjs';

// PLACEHOLDER proof flow: replaced per ticket so that it demonstrates that ticket's
// acceptance criteria (1 Ticket = 1 Proof Video). Keep the structure: seeded start,
// visible steps with assertions, closing step in the mock inspector.

const OUT_DIR = process.env.EVIDENCE_OUT || path.resolve('./artifacts');
const SCREENSHOT_DIR = path.join(OUT_DIR, 'screenshots');
const SINTEL_URL = 'https://www.youtube.com/watch?v=eRsGyueVLvQ';

test.beforeAll(async () => {
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
});

test('Level 1 focused proof: seeded history, Sintel audio download with progress, mock inspector shows /add', async ({
  page,
  request,
}) => {
  const TOTAL_STEPS = 3;
  const session = createProofSession(page, { outDir: OUT_DIR, screenshotDir: SCREENSHOT_DIR });

  // Wait for the seeded history BEFORE Step 1 so frame 1 never shows the empty-state flash.
  await page.goto('/');
  const cards = page.locator('#done .item');
  await expect(cards).toHaveCount(2);
  await expect(cards.first().locator('.fmt[data-state="have"]').first()).toBeVisible();
  session.markReady();

  // Step 1/3: the seeded history
  await session.beginStep(1, TOTAL_STEPS, 'Seeded history: two videos with their formats');
  const bunny = cards.filter({ hasText: 'Big Buck Bunny' });
  const zoo = cards.filter({ hasText: 'Me at the zoo' });
  await expect(bunny.locator('.fmt[data-kind="video"]')).toHaveAttribute('data-state', 'have');
  await expect(bunny.locator('.fmt[data-kind="thumbnail"]')).toHaveAttribute('data-state', 'have');
  await expect(bunny.locator('.fmt[data-kind="audio"]')).toHaveAttribute('data-state', 'missing');
  await expect(zoo.locator('.fmt[data-kind="captions"]')).toHaveAttribute('data-state', 'have');
  await highlightLocator(page, bunny);
  await highlightLocator(page, zoo);
  await session.finishStep({
    screenshotFile: '01-seeded-history.png',
    assertion: 'History lists Big Buck Bunny (Video and Image saved) and Me at the zoo (Text saved); every other format cell offers "request"',
    minStepMs: 3200,
    holdEndMs: 1800,
  });

  // Step 2/3: download Sintel as audio, progress visible, ends saved
  await session.beginStep(2, TOTAL_STEPS, 'Paste a link, tap Audio twice, watch the progress');
  await humanType(page, page.locator('#url'), SINTEL_URL, { charDelayMs: 28 });
  const audioTile = page.locator('#tiles .tile[data-kind="audio"]');
  await highlightAndClick(page, audioTile); // first tap selects
  await expect(page.locator('#status')).toContainText('again to start');
  await highlightAndClick(page, audioTile); // second tap sends
  await expect(page.locator('#status')).toContainText('Sent');

  const running = page.locator('#active .item').filter({ hasText: 'Sintel' });
  await expect(running.locator('.meta')).toContainText(/loading \d+ %/);
  await page.waitForTimeout(1500); // let the viewer see the progress bar move

  const sintel = cards.filter({ hasText: 'Sintel' });
  await expect(sintel.locator('.fmt[data-kind="audio"]')).toHaveAttribute('data-state', 'have', { timeout: 20_000 });
  await expect(sintel.locator('.fmt[data-kind="audio"] .verb')).toHaveText('save');
  await expect(page.locator('#active .item')).toHaveCount(0);
  await highlightLocator(page, sintel);
  await session.finishStep({
    screenshotFile: '02-sintel-audio-saved.png',
    assertion: 'Running card showed "loading N %"; afterwards the Sintel card in History has a saved Audio cell and nothing is left under Running',
    minStepMs: 3200,
    holdEndMs: 1800,
  });

  // Step 3/3: the mock MeTube inspector lists the /add the companion sent
  const eventsRes = await request.get(`${MOCK_URL}/_mock/events`);
  expect(eventsRes.ok()).toBeTruthy();
  const { events } = await eventsRes.json();
  const adds = events.filter((e) => e.path === '/add');
  expect(adds).toHaveLength(1);
  expect(adds[0].body).toMatchObject({ url: SINTEL_URL, download_type: 'audio', format: 'm4a', quality: 'best' });

  await page.goto(`${MOCK_URL}/`);
  await expect(page.locator('h1')).toContainText('Mock MeTube');
  const addRow = page.locator('tr').filter({ hasText: '/add' });
  await expect(addRow).toHaveCount(1);
  await expect(addRow).toContainText('eRsGyueVLvQ');
  await expect(addRow).toContainText('"download_type":"audio"');

  await session.beginStep(3, TOTAL_STEPS, 'Mock inspector shows the recorded /add');
  await highlightLocator(page, addRow);
  await session.finishStep({
    screenshotFile: '03-mock-inspector.png',
    assertion: 'Mock MeTube inspector lists the companion\'s POST /add for the Sintel link with download_type "audio"',
    minStepMs: 3200,
    holdEndMs: 2200,
  });

  await session.saveMetadata();
});
