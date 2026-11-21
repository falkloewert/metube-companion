import { test, expect, MOCK_URL } from '../scripts/sandbox.mjs';

const SINTEL_URL = 'https://www.youtube.com/watch?v=eRsGyueVLvQ';

const cell = (card, kind) => card.locator(`.fmt[data-kind="${kind}"]`);

test('Seeded history renders both cards with the right format cells', async ({ page }) => {
  await page.goto('/');
  const cards = page.locator('#done .item');
  await expect(cards).toHaveCount(2);

  const bunny = cards.filter({ hasText: 'Big Buck Bunny' });
  await expect(bunny).toHaveCount(1);
  for (const [kind, state, verb] of [
    ['video', 'have', 'save'],
    ['audio', 'missing', 'request'],
    ['captions', 'missing', 'request'],
    ['thumbnail', 'have', 'save'],
  ]) {
    await expect(cell(bunny, kind), `Big Buck Bunny ${kind}`).toHaveAttribute('data-state', state);
    await expect(cell(bunny, kind).locator('.verb')).toHaveText(verb);
  }

  const zoo = cards.filter({ hasText: 'Me at the zoo' });
  await expect(zoo).toHaveCount(1);
  for (const [kind, state, verb] of [
    ['video', 'missing', 'request'],
    ['audio', 'missing', 'request'],
    ['captions', 'have', 'show'],
    ['thumbnail', 'missing', 'request'],
  ]) {
    await expect(cell(zoo, kind), `Me at the zoo ${kind}`).toHaveAttribute('data-state', state);
    await expect(cell(zoo, kind).locator('.verb')).toHaveText(verb);
  }

  // The thumbnail came from the routed fixture, not from i.ytimg.com.
  await expect
    .poll(() => bunny.locator('.kind img').evaluate((img) => img.complete && img.naturalWidth > 0))
    .toBe(true);
});

test('Adding a link shows progress and ends with a saved audio cell; /add payload is recorded', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.locator('#done .item')).toHaveCount(2);

  await page.locator('#url').fill(SINTEL_URL);
  const audioTile = page.locator('#tiles .tile[data-kind="audio"]');
  await audioTile.click(); // first tap selects
  await expect(page.locator('#status')).toContainText('again to start');
  await audioTile.click(); // second tap sends
  await expect(page.locator('#status')).toContainText('Sent');

  // Running card: progress goes from "starting" to "loading N %".
  const running = page.locator('#active .item').filter({ hasText: 'Sintel' });
  await expect(running).toHaveCount(1);
  await expect(running.locator('.meta')).toContainText(/loading \d+ %/);

  // Finished: the History card has a saved audio cell.
  const card = page.locator('#done .item').filter({ hasText: 'Sintel' });
  await expect(cell(card, 'audio')).toHaveAttribute('data-state', 'have', { timeout: 20_000 });
  await expect(cell(card, 'audio').locator('.verb')).toHaveText('save');
  await expect(page.locator('#active .item')).toHaveCount(0);

  // The companion sent exactly one /add with the audio payload.
  const res = await request.get(`${MOCK_URL}/_mock/events`);
  expect(res.ok()).toBeTruthy();
  const { events } = await res.json();
  const adds = events.filter((e) => e.path === '/add');
  expect(adds).toHaveLength(1);
  expect(adds[0].body).toMatchObject({
    url: SINTEL_URL,
    download_type: 'audio',
    format: 'm4a',
    quality: 'best',
  });
});
