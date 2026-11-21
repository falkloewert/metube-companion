'use strict';
// Drives the real web UI for the demo video and captures it as a screencast
// (JPEG frames with timestamps). Waiting times are marked, so build time can
// squeeze them out. Called by record.sh; needs Node and Playwright.
//
//   BASE=http://localhost:18999 OUT=/tmp/x node record.js
//
// Writes OUT/frames/*.jpg and OUT/frames.txt (ffmpeg concat list with the
// final timing: downloads sped up, cuts between scenes removed).

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://localhost:18999';
const OUT = process.env.OUT || path.join(process.cwd(), 'demo-out');
const SHOTS = process.env.SHOTS || '';   // debug: also save a PNG at every caption
const W = 1920, H = 1080;

// "Rocket Science in 60 Seconds" (NASA, public domain): spoken English, so the
// transcript is English. The others are Blender open movies, only used to fill
// the history of the desktop scene.
const MAIN = 'https://www.youtube.com/watch?v=MLgYJh6OFbY';
const SEEDS = [
  ['https://www.youtube.com/watch?v=VfmHda5e4II', ['thumbnail', 'captions']],
  ['https://www.youtube.com/watch?v=aqz-KE-bpKQ', ['thumbnail', 'audio']],       // Big Buck Bunny
  ['https://www.youtube.com/watch?v=eRsGyueVLvQ', ['thumbnail']],                // Sintel
  ['https://www.youtube.com/watch?v=R6MlUcmOul8', ['thumbnail', 'audio']],       // Tears of Steel
  ['https://www.youtube.com/watch?v=WhWc3b3KhnY', ['thumbnail']],                // Spring
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now() / 1000;
const log = (...a) => console.log('[demo]', ...a);

(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'frames'), { recursive: true });
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, colorScheme: 'dark', locale: 'en-US' });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  // Headless Chromium never reports a focused document, so the real clipboard
  // is refused. The "clipboard" of the demo is stubbed with the link instead.
  await ctx.addInitScript((u) => {
    if (window !== window.top) navigator.clipboard.readText = async () => u;
  }, MAIN);
  const page = await ctx.newPage();

  // Serve the stage next to the UI so the frames are same-origin.
  const stageHtml = fs.readFileSync(path.join(__dirname, 'stage.html'), 'utf8');
  await page.route(BASE + '/__stage.html', (r) => r.fulfill({ contentType: 'text/html', body: stageHtml }));
  await page.goto(BASE + '/__stage.html');

  const phone = page.frameLocator('#phone');
  const desk = page.frameLocator('#desk');

  // ---- Screencast ----------------------------------------------------------
  const frames = [];
  const cdp = await ctx.newCDPSession(page);
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    const file = path.join('frames', String(frames.length).padStart(6, '0') + '.jpg');
    fs.writeFileSync(path.join(OUT, file), Buffer.from(data, 'base64'));
    frames.push({ t: metadata.timestamp, file });
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  const segs = [];   // {t0, t1, speed}, speed Infinity = cut

  // ---- Cursor and taps -----------------------------------------------------
  let pos = [W * 0.6, H * 0.6];
  const ease = (k) => (k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
  const setCur = (x, y) => page.evaluate(([a, b]) => { const c = document.getElementById('cur'); c.style.left = a + 'px'; c.style.top = b + 'px'; }, [x, y]);
  async function glide(x, y, ms = 520) {
    const [sx, sy] = pos;
    const steps = Math.max(10, Math.round(ms / 18));
    for (let i = 1; i <= steps; i++) {
      const k = ease(i / steps);
      const px = sx + (x - sx) * k, py = sy + (y - sy) * k;
      await page.mouse.move(px, py);
      await setCur(px, py);
      await sleep(14);
    }
    pos = [x, y];
  }
  const curClass = (cls, on) => page.evaluate(([c, o]) => document.getElementById('cur').classList.toggle(c, o), [cls, on]);
  // Visible range of the active frame (page coordinates), to scroll smoothly
  // instead of jumping.
  const viewRange = () => page.evaluate(() => {
    const r = document.querySelector('.scene.on #phoneWrap, .scene.on #deskWrap').getBoundingClientRect();
    return [r.top, r.bottom];
  });
  async function tap(loc, { pause = 400, ms = 520 } = {}) {
    await loc.waitFor({ state: 'visible' });
    const [top, bottom] = await viewRange();
    let b = await loc.boundingBox();
    for (let i = 0; i < 120; i++) {
      const c = b.y + b.height / 2;
      if (c > top + 100 && c < bottom - 70) break;
      await page.mouse.move(pos[0], pos[1]);
      await page.mouse.wheel(0, c > (top + bottom) / 2 ? 36 : -36);
      await sleep(16);
      b = await loc.boundingBox();
    }
    await glide(b.x + b.width / 2, b.y + b.height / 2, ms);
    await curClass('down', true);
    await sleep(80);
    await page.mouse.down();
    await sleep(60);
    await page.mouse.up();
    await curClass('down', false);
    await sleep(pause);
  }
  const showCur = (on) => curClass('show', on);

  // ---- Captions and scenes ---------------------------------------------------
  let shotN = 0;
  const marks = [];
  async function shot(name) {
    marks.push([name, now()]);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, String(++shotN).padStart(2, '0') + '-' + name + '.png') });
  }
  async function cap(step, line, sub = '') {
    await page.evaluate(([s, l, u]) => {
      const c = document.getElementById('cap');
      c.classList.add('swap');
      setTimeout(() => {
        c.querySelector('.step').textContent = s;
        c.querySelector('.line').textContent = l;
        c.querySelector('.sub').textContent = u;
        c.classList.remove('swap');
      }, 280);
    }, [step, line, sub]);
    await sleep(450);
  }
  async function deskCap(line) {
    await page.evaluate((l) => {
      const c = document.getElementById('deskCap');
      c.classList.add('swap');
      setTimeout(() => { c.querySelector('.line').textContent = l; c.classList.remove('swap'); }, 280);
    }, line);
    await sleep(450);
  }
  const scene = (id, on) => page.evaluate(([i, o]) => document.getElementById(i).classList.toggle('on', o), [id, on]);
  async function cut(fn) {
    // Fade out, hide everything, do something not meant for the video, come back.
    await showCur(false);
    await sleep(600);
    await page.evaluate(() => document.body.classList.add('cut'));
    await sleep(150);
    const t0 = now();
    await fn();
    pos = [1750, 60];   // park the cursor in an empty corner
    await page.mouse.move(pos[0], pos[1]);
    await setCur(pos[0], pos[1]);
    segs.push({ t0, t1: now(), speed: Infinity });
    await page.evaluate(() => document.body.classList.remove('cut'));
    await sleep(100);
  }
  // Wait for something slow (a download), show about `secs` of it.
  async function sped(fn, secs) {
    const t0 = now();
    await fn();
    const t1 = now();
    if (t1 - t0 > secs) segs.push({ t0, t1, speed: (t1 - t0) / secs });
    log('waited', (t1 - t0).toFixed(1), 's');
  }
  const hold = (s) => sleep(s * 1000);

  // ===========================================================================
  // Scene 1: phone, text, audio, video, image
  // ===========================================================================
  await page.evaluate(() => { document.getElementById('phone').src = '/'; });
  await phone.locator('#url').waitFor();
  await scene('phoneScene', true);
  await sleep(600);
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 94, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
  const tStart = now();
  await showCur(true);
  await cap('1 · Paste', 'Paste a link.', 'Any YouTube link.');
  await hold(0.3);
  await tap(phone.locator('#urlbtn'), { pause: 900 });
  await shot('pasted');

  await cap('2 · Send', 'Tap Text.\nTap again.', 'Two taps and it is on its way.');
  await tap(phone.locator('.tile[data-kind=captions]'), { pause: 700 });
  await shot('armed');
  await tap(phone.locator('.tile[data-kind=captions]'), { pause: 400 });
  await sped(() => phone.locator('#active .item').first().waitFor(), 0.6);
  await hold(0.8);
  await shot('running');
  await sped(() => phone.locator('#done .fmt[data-kind=captions][data-state=have]').waitFor({ timeout: 120000 }), 1.6);
  await hold(0.5);

  await cap('3 · Read', 'The transcript,\nready.', 'Preview it, copy it or save it as Markdown.');
  await tap(phone.locator('#done .fmt[data-kind=captions]'), { pause: 1900 });
  await shot('preview');
  await tap(phone.locator('#done .pill.copy'), { pause: 1300 });
  await shot('copied');
  await tap(phone.locator('#done .fmt[data-kind=captions]'), { pause: 400 });   // hide the preview

  await cap('4 · More', 'More formats.\nSame card.', 'MP3 and 480p picked once in the download settings.');
  const settings = phone.locator('details.more', { hasText: 'Download settings' }).locator('summary');
  await tap(settings, { pause: 400 });
  await phone.locator('#pref-audioFormat').selectOption('mp3');
  await hold(0.5);
  await phone.locator('#pref-videoQuality').selectOption('480');
  await hold(0.6);
  await tap(settings, { pause: 200 });
  await shot('settings');

  await tap(phone.locator('#done .fmt[data-kind=audio]'), { pause: 500 });
  await shot('audio-running');
  await sped(() => phone.locator('#done .fmt[data-kind=audio][data-state=have]').waitFor({ timeout: 120000 }), 1.4);
  await hold(0.2);
  await tap(phone.locator('#done .fmt[data-kind=thumbnail]'), { pause: 400 });
  await sped(() => phone.locator('#done .fmt[data-kind=thumbnail][data-state=have]').waitFor({ timeout: 60000 }), 0.8);
  await hold(0.2);
  await tap(phone.locator('#done .fmt[data-kind=video]'), { pause: 500 });
  await sped(() => phone.locator('#done .fmt[data-kind=video][data-state=have]').waitFor({ timeout: 300000 }), 1.4);
  await cap('', 'One card.\nEvery format.', 'Video, audio, text and image, side by side.');
  await hold(2.2);
  await shot('all-green');

  // ===========================================================================
  // Between the scenes (not in the video): fill the history for the desktop scene
  // ===========================================================================
  await cut(async () => {
    await scene('phoneScene', false);
    const seed = await ctx.newPage();
    await seed.goto(BASE + '/');
    const idle = async () => {
      for (let i = 0; i < 600; i++) {
        const h = await (await seed.request.get(BASE + '/api/history')).json();
        if (!(h.queue || []).length && !(h.pending || []).length) return;
        await sleep(1000);
      }
      throw new Error('seed downloads did not finish');
    };
    for (const [url, kinds] of SEEDS) {
      for (const k of kinds) {
        await seed.evaluate(([u, kind]) => add(u, kind), [url, k]);
        await sleep(1500);
        await idle();
      }
    }
    await seed.close();
    await page.evaluate(() => { document.getElementById('desk').src = '/'; });
    await desk.locator('#done .item').first().waitFor();
    await sleep(1200);
    await scene('deskScene', true);
  });

  // ===========================================================================
  // Scene 2: desktop, search, trash, restore
  // ===========================================================================
  await showCur(true);
  await deskCap('Everything you saved, one card per video.');
  await hold(1.2);
  await shot('desk-start');
  await deskCap('Search and filter your history.');
  await tap(desk.locator('#q'), { pause: 300 });
  await page.keyboard.type('blender', { delay: 110 });
  await hold(0.8);
  await tap(desk.locator('.chip[data-f=audio]'), { pause: 1000 });
  await shot('desk-search');

  await deskCap('Deleted by mistake? It waits in the trash.');
  const victim = desk.locator('li.item', { hasText: 'Tears of Steel' });
  await tap(victim.locator('.act.del'), { pause: 600 });
  await shot('desk-armed');
  await tap(victim.locator('.act.del'), { pause: 1100 });
  await shot('desk-deleted');
  await tap(desk.locator('#trash summary'), { pause: 800 });
  await shot('desk-trash');
  await deskCap('One tap brings it back.');
  await tap(desk.locator('#trash-list button', { hasText: 'Restore' }), { pause: 1300 });
  await hold(0.6);
  await shot('desk-restored');
  await showCur(false);

  // ===========================================================================
  // End card
  // ===========================================================================
  await scene('deskScene', false);
  await sleep(500);
  await scene('endScene', true);
  await shot('end');
  await hold(3.4);
  const tEnd = now();
  await cdp.send('Page.stopScreencast');
  await sleep(300);

  // ---- Concat list ---------------------------------------------------------
  const outDur = (a, b) => {
    let d = b - a;
    for (const s of segs) {
      const o = Math.min(b, s.t1) - Math.max(a, s.t0);
      if (o > 0) d -= o - (s.speed === Infinity ? 0 : o / s.speed);
    }
    return d;
  };
  frames.sort((x, y) => x.t - y.t);
  const keep = frames.filter((f) => f.t >= tStart - 0.5);
  const lines = [];
  let total = 0, last = null;
  for (let i = 0; i < keep.length; i++) {
    const a = keep[i].t, b = i + 1 < keep.length ? keep[i + 1].t : tEnd;
    const d = outDur(a, Math.max(a, b));
    if (d < 0.004) continue;
    lines.push(`file '${keep[i].file}'`, `duration ${d.toFixed(4)}`);
    total += d; last = keep[i].file;
  }
  lines.push(`file '${last}'`);   // concat demuxer ignores the duration of the last entry
  fs.writeFileSync(path.join(OUT, 'frames.txt'), lines.join('\n') + '\n');
  log(`${keep.length} frames, ${total.toFixed(1)} s`);
  if (process.env.MARKS) for (const [n, t] of marks) log(n.padEnd(14), outDur(tStart, t).toFixed(1));

  await browser.close();
})().catch(async (e) => {
  console.error(e);
  try {   // what MeTube thinks, for debugging
    const h = await (await fetch(BASE + '/api/history')).json();
    for (const l of ['queue', 'pending', 'done']) for (const i of h[l] || []) console.error(l, i.download_type, i.status, i.msg || i.error || '');
  } catch (_) { /* ignore */ }
  process.exit(1);
});
