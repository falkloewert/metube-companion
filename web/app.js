'use strict';

// Same interaction as the extension (extension/popup.js): tap a tile once to
// select, tap again to send. Entries stay in the DOM as nodes and are only
// updated, so animations and state do not restart on each 2 s poll.

const API = '/api';
const POLL_MS = 2000;

const $ = (id) => document.getElementById(id);
const el = {
  url: $('url'), tiles: $('tiles'), status: $('status'),
  active: $('active'),
  done: $('done'), doneEmpty: $('done-empty'),
  conn: $('conn'), toast: $('toast'),
  cookieFile: $('cookie-file'), cookieStatus: $('cookie-status'), cookieDelete: $('cookie-delete'),
};

let toastTimer = null;

function toast(text, isError) {
  el.toast.textContent = text;
  el.toast.classList.toggle('error', !!isError);
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, isError ? 8000 : 3000);
}

function setStatus(text, bad) {
  el.status.textContent = text;
  el.status.classList.toggle('err', !!bad);
}

function setConn(ok) {
  el.conn.classList.toggle('bad', !ok);
  el.conn.textContent = ok ? 'Connected' : 'Offline';
}

// Protected instance (COMPANION_TOKEN): the token lives in a cookie, so
// downloads via plain links work too. Asked once per browser.
function askToken() {
  const card = $('login');
  if (!card.hidden) return;
  card.hidden = false;
  $('token').focus();
}

$('login').addEventListener('submit', (e) => {
  e.preventDefault();
  const value = $('token').value.trim();
  if (!value) return;
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = 'companion_token=' + encodeURIComponent(value) + '; path=/; max-age=31536000; SameSite=Strict' + secure;
  location.reload();
});

async function api(path, options) {
  const res = await fetch(API + path, options);
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { /* not JSON */ }
  if (res.status === 401) { askToken(); throw new Error('Access token needed.'); }
  if (!res.ok) {
    const msg = (data && (data.msg || data.error)) || res.statusText || ('HTTP ' + res.status);
    throw new Error(msg);
  }
  return data;
}

const post = (path, body) => api(path, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

// ---- YouTube: link form and language --------------------------------------

// Spoken language (rules in shared.js). nginx fetches the watch page at
// /yt/<id> (CORS), without cookies.
async function detectLang(url) {
  try {
    const id = ytId(url);
    if (!id || !/^[\w-]{11}$/.test(id)) return 'de';
    const res = await fetch('/yt/' + id);
    return res.ok ? langFromWatchPage(await res.text()) : 'de';
  } catch (_) {
    return 'de';
  }
}

async function add(url, kind) {
  const body = Object.assign({ url }, PAYLOADS[kind] || PAYLOADS.video);
  if (kind === 'captions') body.subtitle_language = await detectLang(url);
  const res = await post('/add', body);
  if (res && res.status === 'error') throw new Error(res.msg || 'MeTube rejected the request.');
  if (res && /already/i.test(res.msg || '')) throw new Error('Already running.');
  return body.subtitle_language;
}

// ---- Paste / clear -------------------------------------------------------
// Empty: paste from the clipboard (one tap instead of long-press).
// Filled: clear the field.
const PASTE = '<svg viewBox="0 0 24 24"><rect x="8" y="3" width="8" height="4" rx="1"/><path d="M16 5h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2"/></svg>';
const CLEAR = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const urlBtn = $('urlbtn');
function syncUrlBtn() {
  const empty = !el.url.value;
  urlBtn.hidden = empty && !(navigator.clipboard && navigator.clipboard.readText);
  urlBtn.innerHTML = empty ? PASTE : CLEAR;
  urlBtn.title = empty ? 'Paste' : 'Clear';
  urlBtn.setAttribute('aria-label', urlBtn.title);
}
el.url.addEventListener('input', syncUrlBtn);
urlBtn.addEventListener('click', async () => {
  if (el.url.value) { el.url.value = ''; disarm(); syncUrlBtn(); el.url.focus(); return; }
  try {
    el.url.value = (await navigator.clipboard.readText()).trim();
    syncUrlBtn();
    setStatus(el.url.value ? '' : 'Clipboard is empty.', !el.url.value);
  } catch (_) {
    el.url.focus();
    setStatus('Paste not allowed, please long-press and paste.', true);
  }
});

// ---- Tiles -----------------------------------------------------------------

el.tiles.querySelectorAll('.tile').forEach((t) => {
  t.insertAdjacentHTML('afterbegin', SPIN + CHECK('check'));
  t.insertAdjacentHTML('beforeend',
    '<span class="ask">tap again</span><span class="busytxt">sending …</span><span class="donetxt">sent</span>');
});

let armed = null;
let armTimer = null;
let sending = false;

const tile = (kind) => el.tiles.querySelector('[data-kind="' + kind + '"]');

function disarm() {
  clearTimeout(armTimer);
  if (armed && el.status.textContent.endsWith('again to start.')) setStatus('');
  armed = null;
  el.tiles.classList.remove('armed');
  el.tiles.querySelectorAll('.tile').forEach((t) => t.classList.remove('armed'));
}

function arm(kind) {
  disarm();
  armed = kind;
  el.tiles.classList.add('armed');
  tile(kind).classList.add('armed');
  armTimer = setTimeout(disarm, 4000);
}

function burst(t) {
  for (let i = 0; i < 12; i++) {
    const s = document.createElement('span');
    const size = 3 + Math.random() * 3;
    s.className = 'burst';
    s.style.width = s.style.height = size + 'px';
    s.style.setProperty('--a', (i * 30 + (Math.random() * 20 - 10)) + 'deg');
    s.style.setProperty('--d', -(26 + Math.random() * 16) + 'px');
    t.appendChild(s);
  }
  setTimeout(() => t.querySelectorAll('.burst').forEach((s) => s.remove()), 700);
}

function shakeUrl(msg) {
  el.url.classList.remove('shake');
  void el.url.offsetWidth;
  el.url.classList.add('shake');
  el.url.focus();
  setStatus(msg, true);
}

el.tiles.addEventListener('click', (e) => {
  const t = e.target.closest('.tile');
  if (!t || sending) return;
  const url = el.url.value.trim();
  if (!url) { shakeUrl('Paste a link first.'); return; }
  if (!isWebUrl(url)) { shakeUrl('That does not look like a link.'); return; }
  if (armed !== t.dataset.kind) {
    arm(t.dataset.kind);
    setStatus('Tap "' + t.querySelector('.name').textContent + '" again to start.');
    return;
  }
  send(canonical(url), t.dataset.kind, t);
});

document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && armed) disarm(); });
// Enter in the field acts like a tap: selects Video, a second Enter sends.
el.url.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  tile(armed || 'video').click();
});
document.addEventListener('click', (e) => { if (armed && !e.target.closest('.tile')) disarm(); });

async function send(url, kind, t) {
  disarm();
  sending = true;
  el.tiles.classList.add('sending');
  t.classList.add('busy');
  setStatus(kind === 'captions' ? 'Detecting language …' : 'Sending …');
  try {
    const lang = await add(url, kind);
    t.classList.remove('busy');
    t.classList.add('done');
    burst(t);
    setStatus(lang ? 'Sent, text in ' + (lang === 'en' ? 'English' : 'German') + '.' : 'Sent.');
    el.url.value = '';
    syncUrlBtn();
    refresh();
    setTimeout(() => { t.classList.remove('done'); el.tiles.classList.remove('sending'); sending = false; }, 1300);
  } catch (e) {
    t.classList.remove('busy');
    t.classList.add('fail');
    setStatus(e.message || 'That did not work.', true);
    setTimeout(() => { t.classList.remove('fail'); el.tiles.classList.remove('sending'); sending = false; }, 600);
  }
}

// ---- Display helpers ---------------------------------------------------------

function metaFor(item, kind) {
  switch (item.status) {
    case 'error': return friendlyError(item.msg || item.error);
    case 'finished':
      if (!item.filename) return kind === 'captions' ? 'no text found' : 'no file';
      return 'done';
    default: return item.msg || item.status || '';
  }
}

function itemTitle(item) {
  const t = (item.title || '').trim();
  if (t) return t;
  try { return decodeURI(new URL(item.url).pathname.split('/').filter(Boolean).pop() || item.url); }
  catch (_) { return item.url; }
}

function downloadUrl(filename) {
  return API + '/download/' + relPath(filename).split('/').map(encodeURIComponent).join('/');
}

function flash(btn) {
  btn.classList.remove('flash');
  void btn.offsetWidth;
  btn.classList.add('flash');
  setTimeout(() => btn.classList.remove('flash'), 900);
}

// ---- Formats per video -----------------------------------------------------
// MeTube remembers only the last job per URL. Which formats already exist on
// disk is shown by the file list (nginx /files/): sibling files with the same
// name stem as the job's file.

const listings = new Map();   // folder -> Map file name -> mtime (ms)
// Days until the cleanup deletes a file (RETENTION_DAYS, via /config.js); 0 = never.
const KEEP_DAYS = Number((window.COMPANION || {}).keepDays) || 0;
let listingsAt = 0;
let listingsSig = '';
let lastQueueSig = '';

// Remember the stem per URL: if a later job fails (no file), the formats
// already downloaded stay visible.
const stems = (() => {
  try { return JSON.parse(localStorage.getItem('stems') || '{}'); } catch (_) { return {}; }
})();
function saveStems() {
  try { localStorage.setItem('stems', JSON.stringify(stems)); } catch (_) { /* ignore */ }
}
function rememberStem(url, value) {
  if (stems[url] === value) return;
  stems[url] = value;
  saveStems();
}

async function loadListings(done) {
  const dirs = new Set(['']);
  done.forEach((i) => { if (i.filename) dirs.add(splitPath(relPath(i.filename))[0]); });
  Object.values(stems).forEach((v) => dirs.add(splitPath(v)[0]));
  const sig = done.map((i) => i.url + i.status + (i.filename || '')).join('|');
  if (sig === listingsSig && Date.now() - listingsAt < 15000) return;
  listingsSig = sig;
  listingsAt = Date.now();
  await Promise.all([...dirs].map(async (dir) => {
    try {
      const res = await fetch('/files/' + (dir ? dir.split('/').map(encodeURIComponent).join('/') + '/' : ''),
        { signal: AbortSignal.timeout(5000) });
      // The cleanup removes empty folders; then the old list no longer applies.
      if (res.status === 404) { listings.delete(dir); return; }
      if (!res.ok) return;
      listings.set(dir, parseListing(await res.json()));
    } catch (_) { /* list missing: carry on without siblings */ }
  }));
}

// Stem per URL (localStorage) as fallback when the last job has no file;
// the actual search lives in shared.js.
function siblingsOf(item) {
  let base = null;
  if (item.filename) {
    const [dir, name] = splitPath(relPath(item.filename));
    base = (dir ? dir + '/' : '') + stem(name);
    rememberStem(item.url, base);
  } else {
    base = stems[item.url] || null;
  }
  return siblings(item, listings, base);
}

// "today · 30 days left": the cleanup deletes each file separately after
// KEEP_DAYS, so the oldest file of a video disappears first.
function ageText(files) {
  const times = Object.values(files).map((rel) => {
    const [dir, name] = splitPath(rel);
    return (listings.get(dir) || new Map()).get(name);
  }).filter((t) => isFinite(t));
  if (!times.length) return '';
  const day = 86400000;
  const newest = Math.max(...times);
  const startOf = (t) => new Date(t).setHours(0, 0, 0, 0);
  const ago = Math.round((startOf(Date.now()) - startOf(newest)) / day);
  const when = ago <= 0 ? 'today' : ago === 1 ? 'yesterday' : ago + ' days ago';
  if (!KEEP_DAYS) return when;
  const left = Math.max(0, Math.ceil((Math.min(...times) + KEEP_DAYS * day - Date.now()) / day));
  return when + ' · ' + (left <= 1 ? 'deleted soon' : left + ' days left');
}

async function transcriptOf(rel) {
  const res = await fetch(downloadUrl(rel));
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return cleanTranscript(await res.text());
}

function saveFile(href, name) {
  const a = document.createElement('a');
  a.href = href;
  a.download = name || '';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// Old-style copy through a hidden text field: works on plain HTTP, where the
// clipboard API is missing.
function copyFallback(text) {
  if (!text) return false;
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (_) { /* not supported */ }
  ta.remove();
  return ok;
}

function saveMd(item, text) {
  const title = itemTitle(item) || 'Transcript';
  const md = '# ' + title + '\n\nSource: ' + (item.url || '') + '\n\n' + text + '\n';
  const href = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
  saveFile(href, (title.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 120) || 'Transcript') + '.md');
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

// ---- Entries -----------------------------------------------------------------

// Key is list plus URL: a finished file and a new job with the same URL
// (e.g. text first, then video) appear in both at the same time.
const nodes = new Map();
let wasQueued = new Set();
// Jobs finished while the tab was in the background: "(2) MeTube Companion".
const TITLE = document.title;
let unseen = 0;
let jobs = new Map();         // URL -> Map kind -> running job
const progs = new Map();      // progress per URL|kind, see progress() in shared.js

function button(cls, title, icon, tag) {
  const b = document.createElement(tag || 'button');
  if (!tag) b.type = 'button';
  b.className = 'act ' + cls;
  b.title = title;
  b.setAttribute('aria-label', title);
  b.innerHTML = icon + CHECK('tick');
  return b;
}

function makeNode() {
  const li = document.createElement('li');
  li.className = 'item';
  li.innerHTML = '<div class="head"><div class="kind" aria-hidden="true"></div>' +
    '<div class="text"><a class="title" target="_blank" rel="noopener"></a><div class="meta"></div></div></div>' +
    '<div class="bar"><div class="fill"></div></div>' +
    '<div class="formats" role="group" aria-label="Formats"></div>' +
    '<div class="textpanel" hidden><div class="tp-head"></div><p class="preview"></p><div class="tp-actions">' +
    '<button type="button" class="pill copy">' + ICON.copy + CHECK('tick') + 'Copy all</button>' +
    '<button type="button" class="pill md">' + ICON.md + CHECK('tick') + 'As .md</button></div></div>';
  const formats = li.querySelector('.formats');
  const cells = {};
  for (const f of FORMATS) {
    const c = document.createElement('button');
    c.type = 'button';
    c.className = 'fmt';
    c.dataset.kind = f.kind;
    c.innerHTML = ICON[f.kind] + SPIN + CHECK('tick') +
      '<span class="lbl">' + f.label + '</span><span class="verb"></span>';
    formats.appendChild(c);
    cells[f.kind] = c;
  }

  const actions = document.createElement('div');
  actions.className = 'actions';
  const b = {
    report: button('', 'Report this problem on GitHub', ICON.report, 'a'),
    open: button('open', 'Open original', ICON.open, 'a'),
    del: button('del', 'Delete', ICON.del),
  };
  b.del.insertAdjacentHTML('beforeend', '<span class="ask">Delete?</span>');
  b.open.target = b.report.target = '_blank';
  b.open.rel = b.report.rel = 'noopener';
  Object.values(b).forEach((x) => actions.appendChild(x));
  li.appendChild(actions);

  const panel = li.querySelector('.textpanel');
  const n = { li, b, cells, actions, panel, item: null, where: null, all: [], files: {}, text: null, delTimer: null };

  formats.addEventListener('click', (e) => {
    const c = e.target.closest('.fmt');
    if (c) onFormat(n, c);
  });

  const copy = panel.querySelector('.copy');
  copy.addEventListener('click', async () => {
    try {
      // ClipboardItem with a promise: Safari rejects writeText after an await.
      const text = textOf(n);
      if (window.ClipboardItem && navigator.clipboard.write) {
        await navigator.clipboard.write([new ClipboardItem({ 'text/plain': text.then((t) => new Blob([t], { type: 'text/plain' })) })]);
      } else {
        await navigator.clipboard.writeText(await text);
      }
      flash(copy);
      toast('Text copied.');
    } catch (e) {
      // Browsers only allow the clipboard over HTTPS or localhost.
      if (copyFallback(await textOf(n).catch(() => ''))) { flash(copy); toast('Text copied.'); return; }
      toast(window.isSecureContext ? 'Copy did not work, use .md instead.' : 'Copying needs HTTPS here, use .md instead.', true);
    }
  });
  const md = panel.querySelector('.md');
  md.addEventListener('click', async () => {
    try {
      saveMd(n.item, await textOf(n));
      flash(md);
    } catch (e) { toast('Download failed: ' + e.message, true); }
  });

  // Delete is the only action that asks first: the first tap shows "Delete?",
  // the second deletes. Cancels after 4 s or on a click elsewhere.
  b.del.addEventListener('click', async () => {
    if (!b.del.classList.contains('armed')) {
      document.querySelectorAll('.act.del.armed').forEach((x) => x.classList.remove('armed'));
      b.del.querySelector('.ask').textContent = n.where === 'queue' ? 'Cancel?' : 'Delete files?';
      b.del.classList.add('armed');
      n.delTimer = setTimeout(() => b.del.classList.remove('armed'), 4000);
      return;
    }
    clearTimeout(n.delTimer);
    b.del.disabled = true;
    try {
      const res = await post('/delete', { ids: [n.item.url], where: n.where, delete_files: true });
      if (res && res.status === 'error') throw new Error(res.msg || 'MeTube refused.');
      // MeTube deletes only the last job's file; nginx removes the other
      // formats of the same video (DELETE /files/...). 404 = already gone.
      if (n.where === 'done') {
        // Fresh list, so a format that just finished is included.
        listingsAt = 0;
        await loadListings([n.item]);
        const all = siblingsOf(n.item);
        const gone = await Promise.all(all.map((rel) =>
          fetch('/files/' + rel.split('/').map(encodeURIComponent).join('/'), { method: 'DELETE' })
            .then((r) => r.ok || r.status === 404, () => false)));
        delete stems[n.item.url];
        saveStems();
        listingsAt = 0;
        if (gone.includes(false)) throw new Error('not all formats could be deleted.');
      }
      toast(n.where === 'queue' ? 'Cancelled.' : 'Deleted.');
    } catch (e) {
      toast('That did not work: ' + e.message, true);
    } finally {
      b.del.disabled = false;
      b.del.classList.remove('armed');
      refresh();
    }
  });

  return n;
}

// Fetch the text once and keep it for preview, copy and .md.
function textOf(n) {
  const rel = n.files.captions;
  if (!n.text || n.text.rel !== rel) {
    const promise = transcriptOf(rel);
    promise.catch(() => { n.text = null; });   // the next tap retries
    n.text = { rel, promise };
  }
  return n.text.promise;
}

function setVerb(c, label, verb) {
  c.querySelector('.verb').textContent = verb;
  c.title = verb === 'waiting' ? label + ': only when the running job is done' : label + ' ' + verb;
  c.setAttribute('aria-label', c.title);
}

function toggleText(n, open) {
  const c = n.cells.captions;
  n.panel.hidden = !open;
  c.classList.toggle('open', open);
  c.setAttribute('aria-expanded', String(open));
  if (c.dataset.state === 'have') setVerb(c, 'Text', open ? 'hide' : 'show');
  if (!open) return;
  const preview = n.panel.querySelector('.preview');
  const head = n.panel.querySelector('.tp-head');
  head.textContent = 'Preview';
  preview.textContent = 'Loading text …';
  preview.classList.add('loading');
  textOf(n).then((t) => {
    preview.textContent = t || 'The text is empty.';
    const words = t ? t.split(' ').length : 0;
    head.textContent = 'Preview · ' + words.toLocaleString() + ' words';
  },
    (e) => { preview.textContent = 'Could not load text: ' + e.message; })
    .finally(() => preview.classList.remove('loading'));
}

// A tap does what the cell says: save, show text, request, retry. Requesting
// does not ask first; a running format is cancelled by tapping its cell twice.
async function onFormat(n, c) {
  const kind = c.dataset.kind;
  const state = c.dataset.state;
  if (state === 'blocked' || c.dataset.inflight === '1') return;
  if (state === 'busy') {
    if (!c.classList.contains('cancel')) {
      c.classList.add('cancel');
      setVerb(c, c.querySelector('.lbl').textContent, 'tap to cancel');
      setTimeout(() => c.classList.remove('cancel'), 4000);
      return;
    }
    c.classList.remove('cancel');
    try {
      const res = await post('/delete', { ids: [n.item.url], where: 'queue' });
      if (res && res.status === 'error') throw new Error(res.msg || 'MeTube refused.');
      toast('Cancelled.');
    } catch (e) {
      toast('Cancel did not work: ' + e.message, true);
    }
    refresh();
    return;
  }
  if (state === 'have') {
    if (kind === 'captions') { toggleText(n, n.panel.hidden); return; }
    saveFile(downloadUrl(n.files[kind]), splitPath(n.files[kind])[1]);
    flash(c);
    return;
  }
  c.dataset.state = 'busy';
  c.dataset.inflight = '1';
  c.classList.add('wait');
  setVerb(c, c.querySelector('.lbl').textContent, 'starting …');
  try {
    const { url } = n.item;
    if (state === 'fail' && n.item.status === 'error') {
      // Errors go through MeTube's /retry: keeps the options (language, preset).
      const res = await post('/retry', { id: url });
      if (res && res.status === 'error') throw new Error(res.msg || 'Retry failed.');
      await post('/delete', { ids: [url], where: 'done' });
    } else {
      await add(url, kind);
    }
    c.dataset.sent = Date.now();
    toast((FORMATS.find((f) => f.kind === kind) || {}).label + ' is loading.');
    setTimeout(refresh, 600);
  } catch (e) {
    c.classList.remove('wait');
    c.dataset.state = state;
    setVerb(c, c.querySelector('.lbl').textContent, VERBS[state]);
    toast(e.message || 'That did not work.', true);
  } finally {
    delete c.dataset.inflight;
  }
}

document.addEventListener('click', (e) => {
  if (e.target.closest('.act.del')) return;
  document.querySelectorAll('.act.del.armed').forEach((x) => x.classList.remove('armed'));
});

function update(n, item, where) {
  const kind = item.download_type || 'video';
  const running = where === 'queue';
  const failed = item.status === 'error' || (item.status === 'finished' && !item.filename);
  const finished = !running && !failed;

  const moved = n.where === null && where === 'done' && wasQueued.has(item.url);
  n.item = item;
  n.where = where;

  const { li, b, cells } = n;
  const kindEl = li.querySelector('.kind');
  n.all = running ? [] : siblingsOf(item);
  n.files = byKind(n.all);
  // Thumbnail also for a failed job as long as the video has other files;
  // with nothing at all (e.g. wrong link) the kind icon.
  const thumb = item.status === 'error' && !n.all.length ? null : thumbFor(item.url);
  const look = thumb || kind;
  if (kindEl.dataset.look !== look) {
    kindEl.dataset.look = look;
    kindEl.classList.toggle('thumb', !!thumb);
    kindEl.innerHTML = thumb ? '<img alt="" loading="lazy" referrerpolicy="no-referrer">' : (ICON[kind] || ICON.video);
    if (thumb) kindEl.firstChild.src = thumb;
  }
  const title = li.querySelector('.title');
  title.textContent = itemTitle(item);
  const web = isWebUrl(item.url);
  if (web) title.href = item.url; else title.removeAttribute('href');
  const run = running ? progress(item, progs) : null;
  li.querySelector('.meta').textContent = run ? run.verb :
    (finished && ageText(n.files)) || metaFor(item, kind);
  li.querySelector('.meta').title = finished && KEEP_DAYS ? 'Files are deleted automatically ' + KEEP_DAYS + ' days after download.' : '';

  li.classList.toggle('running', running);
  li.classList.toggle('finished', finished);
  li.classList.toggle('error', failed);
  li.classList.toggle('wait', !!run && run.pct === null);
  li.querySelector('.fill').style.width = run && run.pct !== null ? Math.max(4, run.pct) + '%' : '';

  // If a job runs for a video that already has a card, the cell itself shows
  // the progress (bar at the bottom, "loading 42 %") instead of a second card
  // under "Running".
  const busy = jobs.get(item.url) || new Map();
  for (const f of FORMATS) {
    const c = cells[f.kind];
    // After a tap the cell stays on "loading" until MeTube has accepted the
    // job (takes a few seconds) and it appears in the list.
    const pending = c.dataset.inflight === '1' || c.dataset.sent > Date.now() - 4000;
    if (c.dataset.state === 'busy' && !busy.has(f.kind) && !n.files[f.kind] && pending) continue;
    // MeTube accepts only one job per URL at a time.
    const state = busy.has(f.kind) ? 'busy' : n.files[f.kind] ? 'have' : busy.size ? 'blocked' :
      failed && kind === f.kind ? 'fail' : 'missing';
    const was = c.dataset.state;
    if (was !== state) {
      c.dataset.state = state;
      if (state === 'busy') c.dataset.sent = Date.now();
    }
    let verb = state === 'have' && f.kind === 'captions' ? (n.panel.hidden ? 'show' : 'hide') : VERBS[state];
    const job = busy.get(f.kind);
    const run = job ? progress(job, progs) : null;
    c.classList.toggle('wait', !!run && run.pct === null);
    c.style.setProperty('--p', (run && run.pct !== null ? Math.max(4, run.pct) : 0) + '%');
    if (run) verb = run.verb;
    if (!c.classList.contains('cancel') && c.querySelector('.verb').textContent !== verb) setVerb(c, f.label, verb);
    if (was === 'busy' && state === 'have') {
      c.classList.remove('wait');
      c.classList.add('finishing');
      setTimeout(() => { c.classList.remove('finishing'); flash(c); }, 450);
      if (document.hidden) { unseen += 1; document.title = '(' + unseen + ') ' + TITLE; }
    }
  }

  if (web) b.open.href = item.url;
  if (failed) b.report.href = reportUrl(item, 'web');
  b.del.title = running ? 'Cancel' : 'Delete, with all formats';
  if (!n.files.captions && !n.panel.hidden) toggleText(n, false);

  const show = { report: failed, open: !running && web, del: true };
  Object.keys(show).forEach((k) => { b[k].hidden = !show[k]; });
  if (moved) {
    li.classList.add('arrive');
    if (document.hidden && finished) { unseen += 1; document.title = '(' + unseen + ') ' + TITLE; }
  }
}

// Only move nodes that are in the wrong place: inserting restarts the CSS
// animations.
function place(list, wanted) {
  wanted.forEach((li, i) => {
    if (list.children[i] !== li) list.insertBefore(li, list.children[i] || null);
  });
  while (list.children.length > wanted.length) list.lastChild.remove();
}

// Only one request at a time: otherwise an older response can overwrite a
// newer one (cell turns green and falls back to "loading").
let refreshing = null;
let refreshAgain = false;
function refresh() {
  if (refreshing) { refreshAgain = true; return refreshing; }
  refreshing = doRefresh().finally(() => {
    refreshing = null;
    if (refreshAgain) { refreshAgain = false; refresh(); }
  });
  return refreshing;
}

async function doRefresh() {
  try {
    const h = await api('/history');
    setConn(true);
    const queue = (h.queue || []).concat(h.pending || []);
    const done = (h.done || []).slice().reverse();
    const known = new Set(done.map((i) => i.url));
    const stale = Object.keys(stems).filter((url) => !known.has(url));
    stale.forEach((url) => { delete stems[url]; });
    if (stale.length) saveStems();
    // A job left the queue: its file is new, so do not wait for the listing cache.
    const qsig = queue.map((i) => i.url + '|' + (i.download_type || 'video')).join(',');
    if (qsig !== lastQueueSig) { lastQueueSig = qsig; listingsAt = 0; }
    await loadListings(done);
    jobs = new Map();
    queue.forEach((i) => {
      if (!jobs.has(i.url)) jobs.set(i.url, new Map());
      jobs.get(i.url).set(i.download_type || 'video', i);
    });
    // New videos appear under "Running", further formats of a known video run
    // inside its card.
    const fresh = queue.filter((i) => !known.has(i.url));
    const live = new Set(queue.map((i) => i.url + '|' + (i.download_type || 'video')));
    for (const key of progs.keys()) if (!live.has(key)) progs.delete(key);
    const seen = new Set();
    const build = (items, where) => items.map((item) => {
      const key = where + ':' + item.url;
      let n = nodes.get(key);
      if (!n) { n = makeNode(); nodes.set(key, n); }
      seen.add(key);
      update(n, item, where);
      return n.li;
    });
    place(el.active, build(fresh, 'queue'));
    place(el.done, build(done, 'done'));
    wasQueued = new Set(queue.map((i) => i.url));
    for (const [key, n] of nodes) if (!seen.has(key)) { n.li.remove(); nodes.delete(key); }
    el.active.closest('section').hidden = fresh.length === 0;
    el.doneEmpty.hidden = done.length > 0;
    lastDone = done;
    clear.btn.hidden = done.length === 0;
    if (!done.length) clear.bar.hidden = true;
  } catch (e) {
    setConn(false);
    if (e.message) el.conn.title = e.message;
  }
}

// ---- Clear all ---------------------------------------------------------------
// Removes every finished entry from the history, optionally with all files of
// all formats. Running jobs are left alone.

const clear = { btn: $('clearall'), bar: $('clearbar'), q: $('clearq') };
let lastDone = [];

clear.btn.addEventListener('click', () => {
  const n = lastDone.length;
  clear.q.textContent = 'Clear ' + n + (n === 1 ? ' entry' : ' entries') + ' from the history?';
  clear.bar.hidden = false;
  $('clear-cancel').focus();
});
$('clear-cancel').addEventListener('click', () => { clear.bar.hidden = true; });

async function clearAll(withFiles) {
  const items = lastDone.slice();
  const buttons = clear.bar.querySelectorAll('button');
  buttons.forEach((x) => { x.disabled = true; });
  try {
    listingsAt = 0;
    await loadListings(items);
    const files = withFiles ? items.flatMap((i) => siblingsOf(i)) : [];
    const res = await post('/delete', { ids: items.map((i) => i.url), where: 'done', delete_files: withFiles });
    if (res && res.status === 'error') throw new Error(res.msg || 'MeTube refused.');
    const gone = await Promise.all([...new Set(files)].map((rel) =>
      fetch('/files/' + rel.split('/').map(encodeURIComponent).join('/'), { method: 'DELETE' })
        .then((r) => r.ok || r.status === 404, () => false)));
    items.forEach((i) => { delete stems[i.url]; });
    saveStems();
    if (gone.includes(false)) throw new Error('some files could not be deleted.');
    toast(withFiles ? 'History and files deleted.' : 'History cleared, files kept.');
    clear.bar.hidden = true;
  } catch (e) {
    toast('That did not work: ' + e.message, true);
  } finally {
    buttons.forEach((x) => { x.disabled = false; });
    listingsAt = 0;
    refresh();
  }
}
$('clear-files').addEventListener('click', () => clearAll(true));
$('clear-history').addEventListener('click', () => clearAll(false));

// ---- Cookies ---------------------------------------------------------------

async function cookieStatus() {
  try {
    const s = await api('/cookie-status');
    const has = !!(s && s.has_cookies);
    el.cookieStatus.textContent = has ? 'Cookies are stored.' : 'No cookies stored.';
    el.cookieDelete.hidden = !has;
  } catch (_) {
    el.cookieStatus.textContent = '';
  }
}

el.cookieFile.addEventListener('change', async () => {
  const file = el.cookieFile.files && el.cookieFile.files[0];
  if (!file) return;
  const data = new FormData();
  data.append('cookies', file, 'cookies.txt');
  try {
    await api('/upload-cookies', { method: 'POST', body: data });
    toast('Cookies saved.');
    el.cookieFile.value = '';
    cookieStatus();
  } catch (e) {
    toast('Upload failed: ' + e.message, true);
  }
});

el.cookieDelete.addEventListener('click', async () => {
  try {
    await api('/delete-cookies', { method: 'POST' });
    toast('Cookies removed.');
    cookieStatus();
  } catch (e) {
    toast(e.message, true);
  }
});

// ---- Share on mobile --------------------------------------------------------
// Installed as an app, the page appears in the share menu (manifest.json,
// share_target). Android sends the link as ?url= or hides it in ?text=
// (YouTube app: "Title https://youtu.be/..."). It lands in the field, the
// format is picked via the tiles as usual.
function takeShared() {
  const q = new URLSearchParams(location.search);
  if (!['url', 'text', 'title'].some((k) => q.has(k))) return;
  const found = ['url', 'text', 'title'].map((k) => (q.get(k) || '').match(/https?:\/\/\S+/)).find(Boolean);
  history.replaceState(null, '', location.pathname);
  if (!found) { setStatus('The shared content had no link.', true); return; }
  el.url.value = found[0];
  setStatus('Link taken over. Tap Video, Audio or Text.');
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

// ---- Start -----------------------------------------------------------------

takeShared();
syncUrlBtn();
refresh();
cookieStatus();
// Poll less often in the background, but keep going so the tab counter works.
let tick = 0;
setInterval(() => { tick += 1; if (!document.hidden || tick % 5 === 0) refresh(); }, POLL_MS);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  unseen = 0;
  document.title = TITLE;
  refresh();
});
