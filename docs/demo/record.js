'use strict';
// Drives the demo video, fully automatic (see record.sh, which starts this under
// xvfb-run). Three parts, recorded in different ways because they need different
// things:
//
//   1. extension: a real headed Chromium with the built extension, on a real
//      YouTube page. Playwright cannot see the toolbar, the popup, the context
//      menu or the system notification, so the whole X display is recorded with
//      ffmpeg (x11grab) and the mouse is real X input (xinput.py).
//   2. web UI (desktop) and 3. phone: the real web UI in iframes of stage.html,
//      captured as a CDP screencast (JPEG frames with timestamps).
//
// Output (OUT): manifest.json with, per part, the source, the sped-up/cut
// segments and the sound events (all in wall-clock seconds); compose.py turns
// that into the final video.
//
//   BASE=http://localhost:8081 EXT=<unpacked extension> OUT=/tmp/x node record.js
//   PARTS=1 node record.js   # only part 1 (for development)

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const crypto = require('crypto');
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://localhost:8081';
const EXT = process.env.EXT;
const OUT = process.env.OUT || path.join(process.cwd(), 'demo-out');
const SHOTS = process.env.SHOTS || '';   // debug: also save a PNG at every mark
const PARTS = process.env.PARTS || 's12';   // s = seed the history, 1 = extension, 2 = web UI and phone
const W = 1920, H = 1080;
const DSF = 2;                            // part 1: 960x540 CSS px on a 1920x1080 screen

// "Rocket Science in 60 Seconds" (NASA, public domain): spoken English, so the
// transcript is English. Part 1 sends the first one with the popup and another
// one of the series with the context menu. The Blender open movies only fill
// the history of the web UI scene.
const MAIN = 'https://www.youtube.com/watch?v=MLgYJh6OFbY';
const SECOND_ID = 'p0W_cxbbTQA';          // preferred; any other episode of the series does too
const SEARCH = 'https://www.youtube.com/results?search_query=NASA+Rocket+Science+in+60+Seconds';
const SHARED = 'https://www.youtube.com/watch?v=LI3QcD11XO8';   // part 3: "shared" to the app
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
const history = async () => (await fetch(BASE + '/api/history')).json();

const manifest = { parts: [] };
let shotN = 0;

// ---- Part 1 helpers: X display, real mouse and keyboard --------------------------

const xshot = (file) => cp.execSync(`import -window root "${file}"`);
function grab(x, y, w, h) {   // raw RGB of a screen area
  return cp.execSync(`import -window root -crop ${w}x${h}+${x}+${y} +repage -depth 8 rgb:-`, { maxBuffer: 1 << 27 });
}
const rgbAt = (x, y) => Array.from(grab(x, y, 1, 1));
const isGreen = ([r, g, b]) => g - r > 18 && g >= b - 2;

function xinput() {
  const p = cp.spawn('python3', [path.join(__dirname, 'xinput.py')], { stdio: ['pipe', 'ignore', 'inherit'] });
  let pos = [1100, 800];
  const send = (l) => p.stdin.write(l + '\n');
  const ease = (k) => (k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
  return {
    get pos() { return pos; },
    move(x, y) { pos = [x, y]; send(`move ${Math.round(x)} ${Math.round(y)}`); },
    // A calm curve, not a straight line.
    async glide(x, y, ms = 700) {
      const [sx, sy] = pos;
      const dx = x - sx, dy = y - sy, len = Math.hypot(dx, dy) || 1;
      const arc = Math.min(60, len * 0.08);
      const steps = Math.max(12, Math.round(ms / 16));
      for (let i = 1; i <= steps; i++) {
        const k = ease(i / steps), bend = Math.sin(Math.PI * k) * arc;
        send(`move ${Math.round(sx + dx * k - dy / len * bend)} ${Math.round(sy + dy * k + dx / len * bend)}`);
        await sleep(16);
      }
      pos = [x, y];
    },
    async click(button = 1) { send('down ' + button); await sleep(70); send('up ' + button); },
    key(name) { send('key ' + name); },
    stop() { p.kill(); },
  };
}

// The overlay (captions, "4x" badge, "... ready" marker, sync flash) lives in the
// YouTube page itself, so the screen recording contains it.
const overlayScript = () => {
  const make = () => {
    if (document.getElementById('demo-ui')) return;
    const root = document.createElement('div');
    root.id = 'demo-ui';
    root.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;font-family:"Liberation Sans","DejaVu Sans",Arial,sans-serif;';
    const cap = document.createElement('div');
    cap.id = 'demo-cap';
    cap.style.cssText = 'position:absolute;left:20px;bottom:42px;max-width:470px;padding:10px 18px 12px;border-radius:16px;background:#0a0e14;color:#f2f5f9;font-size:26px;font-weight:700;line-height:1.22;letter-spacing:-.01em;opacity:0;transition:opacity .3s;';
    const badge = document.createElement('div');
    badge.id = 'demo-badge';
    badge.style.cssText = 'position:absolute;left:20px;top:16px;padding:4px 16px 6px;border-radius:999px;background:#4f8dff;color:#fff;font-size:34px;font-weight:700;opacity:0;transition:opacity .2s;box-shadow:0 2px 10px rgba(0,0,0,.5);';
    const flash = document.createElement('div');
    flash.id = 'demo-flash';
    flash.style.cssText = 'position:absolute;inset:0;background:#fff;display:none;';
    root.append(cap, badge, flash);
    document.documentElement.append(root);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', make); else make();
};

async function extensionPart() {
  if (!EXT || !fs.existsSync(path.join(EXT, 'manifest.json'))) throw new Error('EXT must point to the unpacked extension');
  const part = { name: 'extension', src: 'x11.mkv', segs: [], events: [] };
  const ev = (name) => part.events.push({ t: now(), name });
  const mark = (name) => { if (SHOTS) xshot(path.join(SHOTS, String(++shotN).padStart(2, '0') + '-' + name + '.png')); };

  // The extension id of an unpacked extension is a hash of its path; pinning it
  // puts the icon in the toolbar, as users have it.
  const id = [...crypto.createHash('sha256').update(EXT).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
  const prof = fs.mkdtempSync(path.join(process.env.DEMO_TMP || '/tmp', 'demo-profile.'));
  fs.mkdirSync(path.join(prof, 'Default'));

  // Chromium is started by hand and only attached to by Playwright: a browser
  // launched by Playwright saves every download under a GUID name, a plain one
  // keeps the real file name (which is part of the story).
  const dl = path.join(prof, 'Downloads');
  fs.mkdirSync(dl);
  fs.writeFileSync(path.join(prof, 'Default', 'Preferences'), JSON.stringify({
    extensions: { pinned_extensions: [id] }, download: { default_directory: dl, prompt_for_download: false },
  }));
  const port = 9333;
  const chrome = cp.spawn(chromium.executablePath(), [`--remote-debugging-port=${port}`, `--user-data-dir=${prof}`,
    `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--window-position=0,0',
    `--window-size=${W / DSF},${H / DSF}`, `--force-device-scale-factor=${DSF}`, '--force-dark-mode',
    '--enable-features=WebUIDarkMode', '--lang=en-US', '--accept-lang=en-US', '--no-first-run', '--no-default-browser-check',
    '--hide-crash-restore-bubble', '--password-store=basic', '--use-mock-keychain', '--disable-search-engine-choice-screen',
    '--disable-infobars', 'about:blank'], { stdio: 'ignore', env: Object.assign({}, process.env, { XCURSOR_SIZE: '48' }) });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break; } catch (_) { /* not yet */ }
    await sleep(250);
  }
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const ctx = browser.contexts()[0];
  // Playwright names downloads by GUID; the plain browser behavior keeps the real file name.
  const bs = await browser.newBrowserCDPSession();
  await bs.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dl });
  const x = xinput();
  let cap = null;
  try {
    // ---- Setup, not in the video -------------------------------------------
    if (!ctx.serviceWorkers().length) await ctx.waitForEvent('serviceworker');
    let opts;
    for (let i = 0; i < 75 && !opts; i++) {   // the settings page opens by itself after the install
      opts = ctx.pages().find((p) => p.url().includes('options.html'));
      if (!opts) await sleep(200);
    }
    if (!opts) throw new Error('settings page did not open');
    await opts.fill('#base', BASE);
    await opts.check('#cookies');
    await opts.click('#save');
    await opts.locator('#status', { hasText: 'Saved and connected' }).waitFor({ timeout: 15000 });
    const page = await ctx.newPage();
    await page.emulateMedia({ colorScheme: 'dark' });
    for (const o of ctx.pages()) if (o !== page) await o.close();
    await page.addInitScript(overlayScript);
    let view = page;   // the tab the captions are drawn in
    const demo = (fn, arg) => view.evaluate(fn, arg);
    const caption = async (text) => {
      await demo(async (t) => {
        const c = document.getElementById('demo-cap');
        c.style.opacity = '0';
        await new Promise((r) => setTimeout(r, 260));
        c.textContent = t;
        c.style.opacity = t ? '1' : '0';
      }, text);
    };
    const badge = (text) => demo((t) => {
      const b = document.getElementById('demo-badge');
      b.textContent = t || '';
      b.style.opacity = t ? '1' : '0';
    }, text);

    await page.goto(MAIN, { waitUntil: 'domcontentloaded' });
    // EU consent dialog ("Reject all"); it shows up a few seconds after the page.
    for (let i = 0; i < 40; i++) {
      const rej = page.locator('button:has-text("Reject all")').first();
      if (await rej.isVisible().catch(() => false)) { await rej.click(); await sleep(4000); break; }
      await sleep(500);
    }
    if (await page.getByText('Before you continue').first().isVisible().catch(() => false)) { mark('consent'); throw new Error('consent dialog still open'); }
    await page.locator('#movie_player').waitFor({ timeout: 30000 });
    await sleep(4000);
    const pauseIt = () => page.evaluate(() => {
      const p = document.getElementById('movie_player');
      if (p && p.pauseVideo) { p.mute(); p.seekTo(0, true); p.pauseVideo(); }
      window.scrollTo(0, 0);
    });
    for (let i = 0; i < 4; i++) { await pauseIt(); await sleep(1200); }
    await page.mouse.move(1, 1);   // no hover tooltip from the consent click
    await sleep(1500);

    // A second tab with the search results is ready for the context menu scene
    // (the page load is not interesting to watch).
    const page2 = await ctx.newPage();
    await page2.emulateMedia({ colorScheme: 'dark' });
    await page2.addInitScript(overlayScript);
    await page2.goto(SEARCH, { waitUntil: 'domcontentloaded' });
    await page2.locator('a#video-title').first().waitFor({ timeout: 30000 });
    await sleep(2500);
    const found = await page2.$$eval('a#video-title', (as) => as.map((a) => [(a.href.match(/v=([\w-]{11})/) || [])[1], a.textContent.trim()]));
    const pick = found.find(([id]) => id === SECOND_ID)
      || found.find(([id, t]) => id && !MAIN.includes(id) && !SHARED.includes(id) && /^Rocket Science in 60 Seconds/.test(t));
    if (!pick) { mark('search-failed'); throw new Error('no other episode in the search results'); }
    const secondId = pick[0];
    const link = page2.locator(`a#video-title[href*="v=${secondId}"]`).first();
    await link.evaluate((a) => a.scrollIntoView({ block: 'center' }));
    await page2.evaluate(() => { window.__m = null; addEventListener('mousemove', (e) => { window.__m = [e.clientX, e.clientY]; }, true); });
    await page.bringToFront();
    await sleep(1500);
    for (let i = 0; i < 3; i++) { await pauseIt(); await sleep(600); }

    // Where is the pinned icon? A blue square, right half of the toolbar.
    const strip = grab(0, 80, W, 90);
    let sx = 0, sy = 0, n = 0;
    for (let yy = 0; yy < 90; yy++) for (let xx = 1200; xx < W; xx++) {
      const i = (yy * W + xx) * 3;
      if (Math.abs(strip[i] - 11) < 25 && Math.abs(strip[i + 1] - 107) < 25 && Math.abs(strip[i + 2] - 203) < 30) { sx += xx; sy += yy + 80; n++; }
    }
    if (n < 50) throw new Error('extension icon not found in the toolbar');
    const icon = [Math.round(sx / n), Math.round(sy / n)];
    log('icon at', icon.join(','));
    // Popup geometry relative to the icon (popup is anchored under it).
    const T = { video: [icon[0] - 471, icon[1] + 265], cell: [icon[0] - 493, icon[1] + 635] };

    // ---- Recording ----------------------------------------------------------
    x.move(1150, 760);
    const ff = cp.spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'x11grab', '-framerate', '30', '-draw_mouse', '1',
      '-video_size', `${W}x${H}`, '-i', process.env.DISPLAY, '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '14',
      '-pix_fmt', 'yuv420p', path.join(OUT, 'x11.mkv')], { stdio: ['pipe', 'inherit', 'inherit'] });
    cap = ff;
    await sleep(1500);
    // Sync mark: a white flash; compose.py finds it in the video.
    part.flash = now();
    await demo(() => { document.getElementById('demo-flash').style.display = 'block'; });
    await sleep(350);
    await demo(() => { document.getElementById('demo-flash').style.display = 'none'; });
    await sleep(500);
    part.tStart = now();

    await caption('Watching something? Click the icon. The link is already there.');
    await sleep(600);
    await x.glide(icon[0], icon[1], 700);
    await sleep(150);
    await x.click();
    await sleep(1100);   // popup opens, link already in the field
    mark('popup');
    await x.glide(T.video[0], T.video[1], 600);
    await sleep(200);
    await x.click(); ev('send');      // one tap sends
    await caption('One tap. Your cookies go along, so sign-in-only videos work.');
    await sleep(1500);
    mark('sent');

    // Download runs on the server; the popup shows progress. Sped up.
    await caption('It downloads on your own server.');
    const tWait0 = now();
    await badge('6x');
    let green = false;
    const done = async () => (await history()).done.some((d) => d.url === MAIN && d.status === 'finished');
    for (let i = 0; i < 240; i++) {
      if (await done()) break;
      await sleep(500);
    }
    for (let i = 0; i < 20 && !green; i++) { green = isGreen(rgbAt(...T.cell)); if (!green) await sleep(250); }
    const tWait1 = now();
    ev('done');
    const real = tWait1 - tWait0, factor = Math.max(6, Math.ceil(real / 6 / 2) * 2);
    if (factor !== 6) await badge(factor + 'x');
    part.segs.push({ t0: tWait0 + 0.3, t1: tWait1 - 0.2, speed: factor });
    log('download took', real.toFixed(1), 's, shown at', factor + 'x', 'green cell:', green);
    await sleep(700);
    await badge('');
    await sleep(600);
    mark('green');

    // The "done" notification (Chromium's own, bottom right) comes within seconds.
    await caption('Done. Save it to this computer with one click.');
    let box = null;
    for (let i = 0; i < 80 && !box; i++) {
      const col = grab(1885, 300, 1, 780);   // right padding of the toast: white
      let bottom = -1;
      for (let yy = 779; yy >= 0; yy--) if (col[yy * 3] > 220 && col[yy * 3 + 1] > 220) { bottom = yy + 300; break; }
      if (bottom > 700) box = { bottom };
      else await sleep(250);
    }
    if (!box) throw new Error('done notification did not show');
    await sleep(900);
    mark('notification');
    await x.glide(1456, box.bottom - 52, 600);
    await sleep(250);
    await x.click(); ev('save');
    await sleep(1500);
    mark('saved');
    x.key('Escape');   // closes the popup
    await x.glide(1100, 640, 400);

    // Second video: right-click a link in the search results (context menu).
    // Switch to the other tab with a click on it.
    await x.glide(785, 40, 600);
    await sleep(150);
    await x.click();
    await sleep(350);
    if (await page2.evaluate(() => document.visibilityState) !== 'visible') await page2.bringToFront();
    view = page2;
    await caption('Or right-click any link.');
    // Where on the screen is a point of the page? Ask the page where the real
    // pointer is (window.screenX/Y says nothing about the toolbar's height).
    x.move(900, 640); await sleep(150); x.move(904, 644); await sleep(300);
    const m = await page2.evaluate(() => window.__m);
    if (!m) throw new Error('page did not see the pointer');
    const off = [904 / DSF - m[0], 644 / DSF - m[1]];
    const r = await link.boundingBox();
    const lx = Math.round((r.x + Math.min(r.width / 2, 120) + off[0]) * DSF), ly = Math.round((r.y + r.height / 2 + off[1]) * DSF);
    await x.glide(lx, ly, 700);
    await sleep(300);
    const under = await page2.evaluate(() => { const m = window.__m, e = document.elementFromPoint(m[0], m[1]), l = e && e.closest('a'); return l ? l.href : ''; });
    if (!under.includes(secondId)) throw new Error('pointer is not on the link: ' + under);
    await x.click(3);
    await sleep(800);
    mark('menu');
    // "Send to MeTube": the entry with the blue extension icon.
    const reg = [300, 200, W - 300, H - 200];
    const raw = grab(...reg);
    const cells = new Map();
    for (let yy = 0; yy < reg[3]; yy++) for (let xx = 0; xx < reg[2]; xx++) {
      const i = (yy * reg[2] + xx) * 3;
      if (Math.abs(raw[i] - 11) < 25 && Math.abs(raw[i + 1] - 107) < 25 && Math.abs(raw[i + 2] - 203) < 30) {
        const k = Math.floor(xx / 40) + ',' + Math.floor(yy / 40), c = cells.get(k) || [0, 0, 0];
        c[0]++; c[1] += xx; c[2] += yy; cells.set(k, c);
      }
    }
    const best = [...cells.values()].sort((p, q) => q[0] - p[0])[0];
    if (!best || best[0] < 200) throw new Error('"Send to MeTube" not found in the context menu');
    const item = [reg[0] + best[1] / best[0], reg[1] + best[2] / best[0]];
    log('menu entry at', item.map(Math.round).join(','));
    await x.glide(item[0] + 160, item[1], 500);
    await sleep(300);
    mark('menu-hover');
    await x.click(); ev('send');
    await sleep(800);
    mark('menu-sent');
    await x.glide(1100, 640, 500);
    await sleep(1400);
    mark('end');
    for (let i = 0; i < 20; i++) {
      const h = await history();
      if ([].concat(h.queue, h.pending, h.done).some((d) => d.url.includes(secondId))) break;
      await sleep(500);
      if (i === 19) throw new Error('second video was not sent');
    }
    part.tEnd = now();
    await caption('');
    return part;
  } finally {
    x.stop();
    if (cap) {
      cap.stdin.write('q');
      await new Promise((r) => cap.on('exit', r));
      // When did the flash show in the video? That ties video time to wall-clock time.
      const probe = cp.spawnSync('ffmpeg', ['-hide_banner', '-t', '10', '-i', path.join(OUT, 'x11.mkv'), '-vf',
        'scale=64:36,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-', '-f', 'null', '-'], { encoding: 'utf8' });
      let pts = null;
      for (const line of probe.stdout.split('\n')) {
        const m = line.match(/pts_time:([\d.]+)/);
        if (m) pts = parseFloat(m[1]);
        const y = line.match(/YAVG=([\d.]+)/);
        if (y && parseFloat(y[1]) > 150 && pts !== null) { part.offset = part.flash - pts; break; }
      }
      if (part.offset === undefined) throw new Error('sync flash not found in the recording');
    }
    await browser.close().catch(() => {});
    chrome.kill();
    await sleep(500);
    fs.rmSync(prof, { recursive: true, force: true });
    if (part) manifest.parts.push(part);
  }
}

// ---- Parts 2 and 3: the real web UI on the stage ---------------------------------

// Fills the history of the web UI with a few other videos (not in the video).
async function seedHistory(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 800 } });
  const seed = await ctx.newPage();
  await seed.goto(BASE + '/');
  const idle = async () => {
    for (let i = 0; i < 600; i++) {
      const h = await history();
      if (!(h.queue || []).length && !(h.pending || []).length) return;
      await sleep(1000);
    }
    throw new Error('downloads did not finish');
  };
  for (const [url, kinds] of SEEDS) {
    for (const k of kinds) {
      await seed.evaluate(([u, kind]) => add(u, kind), [url, k]);
      await sleep(1500);
      await idle();
    }
  }
  await ctx.close();
  return idle;
}

async function webParts(browser) {
  const part = { name: 'web', segs: [], events: [] };
  // Sounds go where the event happened: at the click, at the moment a wait ended.
  const ev = (name, t = now()) => part.events.push({ t, name });
  let lastTap = 0, lastDone = 0;
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, colorScheme: 'dark', locale: 'en-US' });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  // A headless browser never reports a focused document, so the real clipboard
  // is refused. The "clipboard" of the demo is stubbed with the link instead.
  await ctx.addInitScript((u) => {
    if (window !== window.top) navigator.clipboard.readText = async () => u;
  }, MAIN);
  const page = await ctx.newPage();
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

  // ---- Cursor and taps -----------------------------------------------------
  let pos = [W * 0.6, H * 0.6];
  const ease = (k) => (k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
  const setCur = (x, y) => page.evaluate(([a, b]) => { const c = document.getElementById('cur'); c.style.left = a + 'px'; c.style.top = b + 'px'; }, [x, y]);
  async function glide(x, y, ms = 420) {
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
  // Visible range of the active frame (page coordinates), to scroll smoothly instead of jumping.
  const viewRange = () => page.evaluate(() => {
    const r = document.querySelector('.scene.on #phoneWrap, .scene.on #deskWrap').getBoundingClientRect();
    return [r.top, r.bottom];
  });
  async function tap(loc, { pause = 300, ms = 420, fx = 0.5 } = {}) {
    await loc.waitFor({ state: 'visible' });
    const [top, bottom] = await viewRange();
    let b = await loc.boundingBox();
    for (let i = 0; i < 160; i++) {
      const c = b.y + b.height / 2;
      if (c > top + 140 && c < bottom - 110) break;
      await page.mouse.move(pos[0], pos[1]);
      const far = Math.abs(c - (top + bottom) / 2);
      await page.mouse.wheel(0, (c > (top + bottom) / 2 ? 1 : -1) * Math.min(140, Math.max(30, far / 6)));
      await sleep(16);
      b = await loc.boundingBox();
    }
    await glide(b.x + b.width * fx, b.y + b.height / 2, ms);
    for (let i = 0; i < 4; i++) {   // the layout may have moved while the pointer traveled (card removed, panel opened)
      const n = await loc.boundingBox();
      if (Math.abs(n.y - b.y) < 4 && Math.abs(n.x - b.x) < 4) break;
      b = n;
      await glide(b.x + b.width * fx, b.y + b.height / 2, 250);
    }
    await curClass('down', true);
    await sleep(80);
    await page.mouse.down();
    await sleep(60);
    await page.mouse.up();
    lastTap = now();
    await curClass('down', false);
    await sleep(pause);
  }
  const showCur = (on) => curClass('show', on);

  // ---- Captions, scenes, badge -------------------------------------------------
  const mark = async (name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, String(++shotN).padStart(2, '0') + '-' + name + '.png') }); };
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
    await sleep(300);
  }
  async function deskCap(line) {
    await page.evaluate((l) => {
      const c = document.getElementById('deskCap');
      c.classList.add('swap');
      setTimeout(() => { c.querySelector('.line').textContent = l; c.classList.remove('swap'); }, 280);
    }, line);
    await sleep(300);
  }
  const scene = (id, on) => page.evaluate(([i, o]) => document.getElementById(i).classList.toggle('on', o), [id, on]);
  const badge = (text, ready) => page.evaluate(([t, r]) => {
    const b = document.getElementById('badge');
    if (t) { b.textContent = t; b.classList.toggle('ready', !!r); }
    b.classList.toggle('on', !!t);
  }, [text, ready]);
  const hold = (s) => sleep(s * 1000);
  // Wait for something slow (a download): sped up and marked with a badge when
  // it takes a while, shown as it is when it is quick.
  async function sped(fn) {
    const t0 = now();
    await badge('8x');          // optimistic: the badge is up before the speed-up starts
    await sleep(350);
    const t1 = now();
    await fn();
    const t2 = now();
    lastDone = t2;
    const real = t2 - t1;
    if (real > 2.5) {
      const speed = Math.max(8, Math.ceil(real / 6 / 2) * 2);
      await badge(speed + 'x');
      part.segs.push({ t0: t1, t1: t2 - 0.1, speed });
      log('waited', real.toFixed(1), 's at', speed + 'x');
      await sleep(250);
      await badge(null);
    } else {
      await badge(null);
      log('waited', real.toFixed(1), 's (not sped up)');
    }
    void t0;
  }
  // Wait until a format cell of a card is green. YouTube now and then refuses a
  // download with HTTP 403; the app retries once by itself, and if the cell
  // still says "retry", tap it once, like a user would.
  async function haveOrRetry(card, kind, timeout) {
    const cell = (s) => card.locator(`.fmt[data-kind=${kind}][data-state=${s}]`);
    for (let i = 0; i < 2; i++) {
      await card.locator(`.fmt[data-kind=${kind}][data-state=have], .fmt[data-kind=${kind}][data-state=fail]`).first().waitFor({ timeout });
      if (await cell('have').count()) return;
      log(kind, 'failed, retrying');
      await cell('fail').click();
    }
    await cell('have').waitFor({ timeout });
  }

  // ===========================================================================
  // Part 2: web UI on the desktop
  // ===========================================================================
  await page.evaluate((u) => {
    document.getElementById('desk').src = '/';
    // the phone loads in the background: a shared link opens the app (see takeShared in app.js)
    document.getElementById('phone').src = '/?url=' + encodeURIComponent(u);
  }, SHARED);
  await phone.locator('#url').waitFor();
  const card = desk.locator('li.item', { hasText: 'Space Launch System' });
  await card.locator('.fmt').first().waitFor();
  await desk.locator('#done .item').nth(3).waitFor();
  await sleep(1200);
  await scene('deskScene', true);
  await sleep(500);
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 94, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
  part.tStart = now();
  await showCur(true);
  await deskCap('Everything you sent, one card per video.');
  await desk.locator('#done').evaluate((e) => e.scrollIntoView({ behavior: 'smooth', block: 'start' }));   // the cards come into view
  await badge('… ready', true);   // the second video of part 1 had to finish downloading
  await hold(0.9);
  await badge(null);
  await hold(0.3);
  await mark('desk-start');

  await deskCap('Transcripts as plain text. Copy or save as Markdown.');
  await tap(card.locator('.fmt[data-kind=captions]'), { pause: 500 }); ev('send', lastTap);
  await sped(() => haveOrRetry(card, 'captions', 120000)); ev('done', lastDone);
  await hold(0.5);
  await tap(card.locator('.fmt[data-kind=captions]'), { pause: 1100 }); ev('tile', lastTap);
  await mark('desk-preview');
  await tap(card.locator('.pill.copy'), { pause: 700 }); ev('copy', lastTap);
  await mark('desk-copied');
  await tap(card.locator('.pill.md'), { pause: 500 }); ev('copy', lastTap);
  await tap(card.locator('.fmt[data-kind=captions]'), { pause: 200 });   // hide the preview

  await deskCap('Need MP3 or 720p? Set it once.');
  const settings = desk.locator('details.more', { hasText: 'Download settings' }).locator('summary');
  await tap(settings, { pause: 500 }); ev('tile', lastTap);
  await desk.locator('#pref-audioFormat').selectOption('mp3');
  await hold(0.4);
  await desk.locator('#pref-videoQuality').selectOption('720');
  await hold(0.4);
  await mark('desk-settings');
  await tap(settings, { pause: 300 });
  await tap(card.locator('.fmt[data-kind=audio]'), { pause: 500 }); ev('send', lastTap);
  await sped(() => haveOrRetry(card, 'audio', 180000)); ev('done', lastDone);
  await hold(0.3);
  await tap(card.locator('.fmt[data-kind=thumbnail]'), { pause: 400 }); ev('send', lastTap);
  await sped(() => haveOrRetry(card, 'thumbnail', 60000)); ev('done', lastDone);
  await hold(1.0);
  await mark('desk-all-green');

  await deskCap('Search and filter your history.');
  await tap(desk.locator('#q'), { pause: 300 });
  await page.keyboard.type('blender', { delay: 85 });
  await hold(0.5);
  await tap(desk.locator('.chip[data-f=audio]'), { pause: 700 }); ev('tile', lastTap);
  await mark('desk-search');

  await deskCap('Deleted by mistake? It waits in the trash.');
  const victim = desk.locator('li.item', { hasText: 'Tears of Steel' });
  await tap(victim.locator('.act.del'), { pause: 450 }); ev('tile', lastTap);
  await mark('desk-armed');
  await tap(victim.locator('.act.del'), { pause: 600 }); ev('trash', lastTap);
  await mark('desk-deleted');
  await tap(desk.locator('#trash summary'), { pause: 450, fx: 0.9 });   // right side: the toast sits in the middle
  await mark('desk-trash');
  await deskCap('One tap brings it back.');
  await tap(desk.locator('#trash-list button', { hasText: 'Restore' }), { pause: 700 }); ev('restore', lastTap);
  await hold(0.2);
  await mark('desk-restored');
  await showCur(false);

  // ===========================================================================
  // Part 3: the phone; a shared link opens the installed app
  // ===========================================================================
  await scene('deskScene', false);
  await sleep(200);
  await scene('phoneScene', true);
  await showCur(true);
  await cap('Phone', 'On Android it installs as an app and shows up in the share menu.');
  await hold(0.9);
  await mark('phone-shared');
  const tile = phone.locator('.tile[data-kind=video]');
  await tap(tile, { pause: 500 }); ev('send', lastTap);
  await sped(() => phone.locator('#done .item', { hasText: 'Engine Section' }).locator('.fmt[data-kind=video][data-state=have]').waitFor({ timeout: 180000 })); ev('done', lastDone);
  await hold(1.0);
  await mark('phone-done');
  await showCur(false);

  // ===========================================================================
  // End card
  // ===========================================================================
  await scene('phoneScene', false);
  await sleep(500);
  await scene('endScene', true);
  await mark('end');
  ev('end');
  await hold(2.3);
  part.tEnd = now();
  await cdp.send('Page.stopScreencast');
  await sleep(300);
  part.frames = frames;
  manifest.parts.push(part);
  await ctx.close();
}


(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'frames'), { recursive: true });
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch();
  try {
    if (PARTS.includes('s')) await seedHistory(browser);
    if (PARTS.includes('1')) await extensionPart();
    if (PARTS.includes('2')) {
      // The second video of part 1 must be done before the web UI shows it.
      for (let i = 0; i < 600; i++) {
        const h = await history();
        if (!(h.queue || []).length && !(h.pending || []).length) break;
        await sleep(1000);
      }
      await webParts(browser);
    }
  } finally {
    await browser.close();
  }
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
