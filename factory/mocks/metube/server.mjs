// Mock MeTube for the factory sandbox: same HTTP API the companion uses
// (recorded from a real MeTube, 2026-11-21), no yt-dlp, no YouTube.
// Downloads are simulated with MeTube's noisy status sequence and write small
// fixture files into DOWNLOAD_DIR, so the companion's file list works as usual.
//
// Test endpoints: GET /health, GET|DELETE /_mock/events (what the companion
// sent), POST /_mock/reset (history, cookies and downloads back to the seed).
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const PORT = Number(process.env.PORT || 8081);
const DIR = process.env.DOWNLOAD_DIR;
const TICK_MS = Number(process.env.MOCK_TICK_MS || 250);
const FIXTURES = new URL('./fixtures/', import.meta.url);
if (!DIR) throw new Error('DOWNLOAD_DIR is required');

// Same owner as the companion, so it can delete and move what we write.
const uid = Number(process.env.PUID || 1000);
const gid = Number(process.env.PGID || 1000);
if (process.getuid?.() === 0) {
  fs.chownSync(DIR, uid, gid);
  process.setgid(gid);
  process.setuid(uid);
}

// Known videos. Unknown YouTube IDs fail like a removed video; flaky403Vid
// fails once with YouTube's 403 (the companion retries that automatically).
const CATALOG = {
  'jNQXAC9IVRw': { title: 'Me at the zoo', lang: 'en' },
  'aqz-KE-bpKQ': { title: 'Big Buck Bunny 60fps 4K - Official Blender Foundation Short Film', lang: 'en' },
  'eRsGyueVLvQ': { title: 'Sintel - Open Movie by Blender Foundation', lang: 'en' },
  'deMockVid01': { title: 'Sandbox: deutsches Testvideo', lang: 'de' },
  'flaky403Vid': { title: 'Sandbox: flaky download (403 once)', lang: 'en', failFirst: true },
};
const TRANSCRIPT = {
  en: 'All right, so here we are, in front of the elephants\nthe cool thing about these guys is that they have really...\nreally really long trunks\nand that\'s cool\n',
  de: 'Das ist ein Testvideo aus der Sandbox.\nEs gibt keine echte Tonspur, nur diesen Text.\n',
};

const ytIdOf = (url) => (String(url).match(/(?:v=|youtu\.be\/|shorts\/)([A-Za-z0-9_-]{11})/) || [])[1];
const watchUrl = (id) => 'https://www.youtube.com/watch?v=' + id;

let queue = [];
let done = [];
let events = [];
let hasCookies = false;
let attempts = {};
let timers = [];

// Field set and defaults of a real MeTube history entry.
function entry(body, video, status) {
  return {
    id: video.id, title: video.title, url: body.url,
    quality: body.quality || 'best', download_type: body.download_type || 'video',
    codec: body.codec || 'auto', format: body.format || 'any', folder: body.folder || null,
    custom_name_prefix: '', msg: null, percent: null, speed: null, eta: null, status,
    size: null, timestamp: Date.now() * 1e6, error: null, playlist_item_limit: 0,
    split_by_chapters: false, sponsorblock: false, audio_tags: 'with_cover',
    subtitle_language: body.subtitle_language || 'en', subtitle_mode: body.subtitle_mode || 'prefer_manual',
    ytdl_options_presets: body.ytdl_options_presets || [], ytdl_options_overrides: {},
    clip_start: null, clip_end: null, live_status: 'not_live', live_release_timestamp: null,
  };
}

function fileFor(item) {
  const stem = `${item.title} [${item.id}]`;
  switch (item.download_type) {
    case 'audio': return { name: `${stem}.${item.format === 'any' ? 'm4a' : item.format}`, data: Buffer.from('mock audio\n') };
    case 'captions': {
      const lang = CATALOG[item.id]?.lang === 'de' ? 'de' : item.subtitle_language;
      return { name: `${stem}.${lang}.txt`, data: Buffer.from(TRANSCRIPT[lang] || TRANSCRIPT.en) };
    }
    case 'thumbnail': return { name: `${stem}.jpg`, data: fs.readFileSync(new URL('thumbnail.jpg', FIXTURES)) };
    default: return { name: `${stem}.${item.format === 'mp4' ? 'mp4' : 'webm'}`, data: Buffer.from('mock video\n') };
  }
}

// One entry per URL: a new result replaces the old one, like MeTube.
function finish(item) {
  queue = queue.filter((q) => q !== item);
  done = done.filter((d) => d.url !== item.url).concat(item);
}

// preparing -> (video: two 0-100 % runs) -> postprocessing -> finished in the
// queue -> done. Captions and thumbnails skip the percentages.
function run(item) {
  const steps = [() => { item.status = 'preparing'; }];
  const runs = item.download_type === 'video' ? 2 : item.download_type === 'audio' ? 1 : 0;
  for (let r = 0; r < runs; r++) {
    for (let p = 0; p <= 100; p += 20) steps.push(() => { item.status = 'downloading'; item.percent = p; });
  }
  const video = CATALOG[item.id];
  if (video?.failFirst && (attempts[item.url] = (attempts[item.url] || 0) + 1) === 1) {
    steps.push(() => {
      item.status = 'error';
      item.percent = null;
      item.msg = 'ERROR: unable to download video data: HTTP Error 403: Forbidden';
      finish(item);
    });
  } else {
    steps.push(() => { item.status = 'postprocessing'; });
    steps.push(() => {
      const file = fileFor(item);
      fs.writeFileSync(path.join(DIR, file.name), file.data);
      item.status = 'finished';
      item.percent = runs ? 100 : null;
      item.filename = file.name;
    });
    steps.push(() => finish(item));
  }
  steps.forEach((step, i) => timers.push(setTimeout(step, (i + 1) * TICK_MS)));
}

function add(body) {
  const id = ytIdOf(body.url);
  if (queue.some((q) => q.url === body.url)) {
    return { status: 'ok', msg: `Already in queue: ${queue.find((q) => q.url === body.url).title}` };
  }
  if (!id || !CATALOG[id]) {
    // MeTube accepts the job and fails it a moment later.
    const item = entry(body, { id: id || 'unknown', title: id ? `youtube video #${id}` : body.url }, 'preparing');
    queue.push(item);
    timers.push(setTimeout(() => {
      item.status = 'error';
      item.msg = `[youtube] ${id} This video is unavailable\nNo video formats found!`;
      finish(item);
    }, 2 * TICK_MS));
    return { status: 'ok' };
  }
  const item = entry(body, { id, title: CATALOG[id].title }, 'pending');
  queue.push(item);
  run(item);
  return { status: 'ok' };
}

function seed() {
  timers.forEach(clearTimeout);
  timers = [];
  queue = [];
  done = [];
  events = [];
  attempts = {};
  hasCookies = false;
  // Never wipe a folder this mock did not create (e.g. a real downloads mount).
  const marker = path.join(DIR, '.factory-sandbox');
  if (!fs.existsSync(marker) && fs.readdirSync(DIR).length) {
    throw new Error(`${DIR} is not empty and has no .factory-sandbox marker; refusing to reset it`);
  }
  for (const name of fs.readdirSync(DIR)) {
    if (name === '.factory-sandbox') continue;
    fs.rmSync(path.join(DIR, name), { recursive: true, force: true });
  }
  fs.writeFileSync(marker, 'Owned by the factory mock MeTube; reset wipes this folder.\n');
  const seeded = [
    ['aqz-KE-bpKQ', 'video'], ['aqz-KE-bpKQ', 'thumbnail'], ['jNQXAC9IVRw', 'captions'],
  ];
  seeded.forEach(([id, type], i) => {
    const item = entry({ url: watchUrl(id), download_type: type, format: type === 'captions' ? 'txt' : type === 'thumbnail' ? 'jpg' : 'any' },
      { id, title: CATALOG[id].title }, 'finished');
    item.timestamp = 1795000000000000000 + i;
    const file = fileFor(item);
    fs.writeFileSync(path.join(DIR, file.name), file.data);
    item.filename = file.name;
    if (type === 'video') item.percent = 100;
    finish(item);
  });
}

// YouTube watch page, only the part langFromWatchPage() in shared.js reads.
function watchPage(id) {
  const lang = CATALOG[id]?.lang;
  if (!lang) return null;
  return `<html><script>var ytInitialPlayerResponse = {"captions":{"playerCaptionsTracklistRenderer":{"captionTracks":[{"baseUrl":"/mock","languageCode":"${lang}","kind":"asr"}],"audioTracks":[{"audioTrack":{"displayName":"original","id":"${lang}.4","audioIsDefault":true}}]}}};</script></html>`;
}

function inspector() {
  const rows = events.slice().reverse().map((e) => `<tr><td>#${e.seq}</td><td>${e.path}</td><td><code>${esc(JSON.stringify(e.body))}</code></td></tr>`).join('');
  return `<!doctype html><meta charset="utf-8"><title>Mock MeTube</title>
<style>body{font:15px system-ui;background:#0f172a;color:#e2e8f0;margin:32px}code{color:#7dd3fc}td{padding:6px 12px;border-bottom:1px solid #334155;vertical-align:top}</style>
<h1>Mock MeTube (sandbox)</h1><p>${done.length} done, ${queue.length} running. Requests from the companion:</p>
<table>${rows || '<tr><td>none yet</td></tr>'}</table>`;
}
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://mock');
  const json = (code, data) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
  const raw = await readBody(req);
  let body = {};
  if (req.headers['content-type']?.includes('json')) {
    try { body = JSON.parse(raw.toString() || '{}'); } catch { return json(400, { status: 'error', msg: 'invalid JSON' }); }
  }
  if (req.method === 'POST' && !url.pathname.startsWith('/_mock')) {
    events.push({ seq: events.length + 1, path: url.pathname, body: req.headers['content-type']?.includes('json') ? body : `(${raw.length} bytes)`, at: new Date().toISOString() });
  }

  const route = `${req.method} ${url.pathname}`;
  if (route === 'GET /health') return json(200, { status: 'ok' });
  if (route === 'GET /_mock/events') return json(200, { events });
  if (route === 'DELETE /_mock/events') { events = []; return json(200, { status: 'ok' }); }
  if (route === 'POST /_mock/reset') { seed(); return json(200, { status: 'ok' }); }
  if (route === 'GET /') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(inspector()); }

  if (route === 'GET /history') return json(200, { done, queue, pending: [] });
  if (route === 'POST /add') return json(200, add(body));
  if (route === 'POST /delete') {
    const ids = new Set(body.ids || []);
    const list = body.where === 'queue' ? queue : done;
    if (body.delete_files) {
      list.filter((i) => ids.has(i.url) && i.filename).forEach((i) => fs.rmSync(path.join(DIR, i.filename), { force: true }));
    }
    if (body.where === 'queue') queue = queue.filter((i) => !ids.has(i.url));
    else done = done.filter((i) => !ids.has(i.url));
    return json(200, { status: 'ok' });
  }
  if (route === 'POST /retry') {
    const old = done.find((i) => i.url === body.id && i.status === 'error');
    if (!old) return json(200, { status: 'error', msg: 'Item not found or not failed' });
    const item = Object.assign({}, old, { status: 'pending', msg: null, error: null, percent: null, timestamp: Date.now() * 1e6 });
    queue.push(item);
    run(item);
    return json(200, { status: 'ok' });
  }
  if (route === 'GET /cookie-status') return json(200, { status: 'ok', has_cookies: hasCookies });
  if (route === 'POST /upload-cookies') { hasCookies = true; return json(200, { status: 'ok' }); }
  if (route === 'POST /delete-cookies') { hasCookies = false; return json(200, { status: 'ok' }); }

  if (req.method === 'GET' && url.pathname === '/watch') {
    const page = watchPage(url.searchParams.get('v'));
    res.writeHead(page ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(page || 'not found');
  }
  if (req.method === 'GET' && url.pathname.startsWith('/download/')) {
    const rel = decodeURIComponent(url.pathname.slice('/download/'.length));
    const file = path.resolve(DIR, rel);
    if (!file.startsWith(path.resolve(DIR) + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      return json(404, { status: 'error', msg: 'not found' });
    }
    res.writeHead(200, { 'Content-Type': file.endsWith('.jpg') ? 'image/jpeg' : 'application/octet-stream' });
    return fs.createReadStream(file).pipe(res);
  }
  return json(404, { status: 'error', msg: `mock: no route for ${route}` });
});

seed();
server.listen(PORT, () => console.log(`mock MeTube on :${PORT}, downloads in ${DIR}, tick ${TICK_MS} ms`));
