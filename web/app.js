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
    if (!id) return 'de';
    const res = await fetch('/yt/' + id);
    return res.ok ? langFromWatchPage(await res.text()) : 'de';
  } catch (_) {
    return 'de';
  }
}

async function add(url, kind) {
  const body = Object.assign({ url }, buildPayload(kind, prefs));
  if (kind === 'captions') body.subtitle_language = await detectLang(url);
  checkAddResult(await post('/add', body));
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

const tileCtl = initTiles({
  tiles: el.tiles,
  urlInput: el.url,
  statusEl: el.status,
  setStatus,
  onSend: async (url, kind) => {
    const lang = await add(url, kind);
    return { status: lang ? 'Sent, text in ' + (lang === 'en' ? 'English' : 'German') + '.' : 'Sent.' };
  },
  onSent: () => { syncUrlBtn(); refresh(); },
});

el.url.addEventListener('input', syncUrlBtn);
urlBtn.addEventListener('click', async () => {
  if (el.url.value) { el.url.value = ''; tileCtl.disarm(); syncUrlBtn(); el.url.focus(); return; }
  try {
    el.url.value = (await navigator.clipboard.readText()).trim();
    syncUrlBtn();
    setStatus(el.url.value ? '' : 'Clipboard is empty.', !el.url.value);
  } catch (_) {
    el.url.focus();
    setStatus('Paste not allowed, please long-press and paste.', true);
  }
});

// Enter in the field acts like a tap: selects Video, a second Enter sends.
el.url.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  tileCtl.click();
});

// ---- Display helpers ---------------------------------------------------------

function itemTitle(item) {
  const t = (item.title || '').trim();
  if (t) return t;
  try { return decodeURI(new URL(item.url).pathname.split('/').filter(Boolean).pop() || item.url); }
  catch (_) { return item.url; }
}

const downloadUrl = (filename) => API + '/download/' + encPath(relPath(filename));

// ---- Formats per video -----------------------------------------------------
// MeTube remembers only the last job per URL. Which formats already exist on
// disk is shown by the file list (nginx /files/): sibling files with the same
// name stem as the job's file.

const listings = new Map();   // folder -> Map file name -> mtime (ms)
// Days until the cleanup deletes a file (RETENTION_DAYS, via /config.js); 0 = never.
const KEEP_DAYS = Number((window.COMPANION || {}).keepDays) || 0;
// Days deleted videos stay in the trash (TRASH_DAYS); 0 = deleted right away.
const TRASH_DAYS = Number((window.COMPANION || {}).trashDays) || 0;
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
      const res = await fetch('/files/' + (dir ? encPath(dir) + '/' : ''),
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
function siblingsOf(item, remember = true) {
  if (item.orphan) return item.orphan;
  let base = null;
  if (item.filename) {
    const [dir, name] = splitPath(relPath(item.filename));
    base = (dir ? dir + '/' : '') + stem(name);
    if (remember) rememberStem(item.url, base);
  } else {
    base = stems[item.url] || null;
  }
  return siblings(item, listings, base);
}

// Files without a history entry (older MeTube installs, a fresh MeTube state,
// files copied in by hand): one card per video, grouped by [<YouTube id>] or
// name stem. With an ID the card acts like a normal one (request works).
// claimed: files of history entries; titles: history entries whose files
// were not found otherwise (no stem in this browser). While jobs run, new
// files wait for their history entry.
// ponytail: only folders already listed (root and those of history entries),
// list subfolders too if users keep orphans deeper. "[...11 chars]" is taken
// as a YouTube ID even when it is not one.
function orphans(claimed, titles, busy) {
  const groups = new Map();
  for (const [dir, names] of listings) {
    for (const [name, mtime] of names) {
      const rel = (dir ? dir + '/' : '') + name;
      const kind = Object.keys(byKind([rel]))[0];
      const s = stem(name);
      if (name.startsWith('.') || claimed.has(rel) || !kind || titles.has(s)) continue;
      if (busy && Date.now() - mtime < 60000) continue;
      const id = (s.match(/\[([\w-]{11})\]$/) || [])[1];
      const key = id ? 'https://www.youtube.com/watch?v=' + id : 'file:' + (dir ? dir + '/' : '') + s;
      if (!groups.has(key)) {
        groups.set(key, { url: key, title: s.replace(/\s*\[[\w-]{11}\]$/, ''), status: 'finished', filename: rel, download_type: kind, orphan: [], at: 0 });
      }
      const g = groups.get(key);
      g.orphan.push(rel);
      g.at = Math.max(g.at, mtime || 0);
    }
  }
  return [...groups.values()].sort((a, b) => b.at - a.at);
}

// MeTube deletes only the last job's file; nginx removes the other formats
// of the same video (DELETE /files/...). 404 = already gone.
function deleteFiles(paths) {
  return Promise.all([...new Set(paths)].map((rel) =>
    fetch('/files/' + encPath(rel), { method: 'DELETE' })
      .then((r) => r.ok || r.status === 404, () => false)));
}

// Trash: nginx moves files to /downloads/.trash/<unix time>/<same path>
// (WebDAV MOVE on /files/). The time in the folder name is when it was moved;
// the cleanup purges the folder after TRASH_DAYS. "Overwrite: F" makes nginx
// refuse (412) instead of replacing an existing file.
// 404 = already gone: fine for a move into the trash, not for a restore
// (strict: nothing came back).
const moveFile = (from, to, strict) => fetch('/files/' + encPath(from), {
  method: 'MOVE', headers: { Destination: '/files/' + encPath(to), Overwrite: 'F' },
}).then((r) => (r.ok || (r.status === 404 && !strict) ? 'ok' : r.status === 412 ? 'exists' : 'fail'), () => 'fail');

// Server time, from the Date header of a /files/ answer: the trash folder name
// must not depend on this device's clock (a wrong phone clock would purge
// at once or never). skew = server minus browser, ms.
let skew = 0;
function noteServerTime(res) {
  const t = Date.parse(res.headers.get('Date') || '');
  if (isFinite(t)) skew = t - Date.now();
  return isFinite(t);
}
const serverNow = () => Date.now() + skew;

async function trashFiles(paths) {
  const res = await fetch('/files/', { method: 'HEAD', cache: 'no-store' }).catch(() => null);
  if (!res || !noteServerTime(res)) return [...new Set(paths)].map(() => false);
  const stamp = Math.floor(serverNow() / 1000);
  return Promise.all([...new Set(paths)].map((rel) => moveFile(rel, '.trash/' + stamp + '/' + rel)))
    .then((r) => r.map((x) => x === 'ok'));
}

// Delete = into the trash, or gone for good without one (TRASH_DAYS=0).
const removeFiles = (paths) => (TRASH_DAYS ? trashFiles(paths) : deleteFiles(paths));

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
  const { blob, filename } = transcriptMd(itemTitle(item), item.url, text);
  const href = URL.createObjectURL(blob);
  saveFile(href, filename);
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
let jobs = new Map();
const autoRetried = {};       // URL -> time, see shouldAutoRetry() in shared.js         // URL -> Map kind -> running job
const progs = new Map();      // progress per URL|kind, see progress() in shared.js

function button(cls, title, icon, tag) {
  const b = document.createElement(tag || 'button');
  if (!tag) b.type = 'button';
  b.className = 'act ' + cls;
  b.title = title;
  b.setAttribute('aria-label', title);
  b.innerHTML = icon;
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
  const cells = makeFormatCells(formats);

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
  const n = { li, b, cells, panel, item: null, where: null, files: {}, text: null, delTimer: null };

  formats.addEventListener('click', (e) => {
    const c = e.target.closest('.fmt');
    if (c) {
      handleFormatClick(c, {
        item: n.item,
        files: n.files,
        onToggleText: () => toggleTextPanel(n.panel, n.cells.captions, n.panel.hidden, () => textOf(n)),
        onSave: (rel) => saveFile(downloadUrl(rel), splitPath(rel)[1]),
        onCancel: async (url) => {
          const res = await post('/delete', { ids: [url], where: 'queue' });
          if (res && res.status === 'error') throw new Error(res.msg || 'MeTube refused.');
        },
        onRetry: (url) => retryJob(url, post),
        onRequest: add,
        notify: toast,
        onAfter: refresh,
      });
    }
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
    } catch (_) {
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
      if (n.item.orphan) {
        if ((await removeFiles(n.item.orphan)).includes(false)) throw new Error('not all formats could be deleted.');
        listingsAt = 0;
        toast(TRASH_DAYS ? 'Moved to the trash.' : 'Deleted.');
        return;
      }
      // With a trash MeTube only drops the history entry; the files move below.
      const res = await post('/delete', { ids: [n.item.url], where: n.where, delete_files: n.where === 'queue' || !TRASH_DAYS });
      if (res && res.status === 'error') throw new Error(res.msg || 'MeTube refused.');
      if (n.where === 'done') {
        // Fresh list, so a format that just finished is included.
        listingsAt = 0;
        await loadListings([n.item]);
        const gone = await removeFiles(siblingsOf(n.item));
        delete stems[n.item.url];
        saveStems();
        listingsAt = 0;
        if (gone.includes(false)) throw new Error('not all formats could be deleted.');
      }
      toast(n.where === 'queue' ? 'Cancelled.' : TRASH_DAYS ? 'Moved to the trash.' : 'Deleted.');
    } catch (e) {
      toast('That did not work: ' + e.message, true);
    } finally {
      b.del.disabled = false;
      b.del.classList.remove('armed');
      refresh();
      loadTrash();
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

document.addEventListener('click', (e) => {
  if (e.target.closest('.act.del')) return;
  document.querySelectorAll('.act.del.armed').forEach((x) => x.classList.remove('armed'));
});

function update(n, item, where) {
  const kind = item.download_type || 'video';
  const running = where === 'queue';
  const failed = isFailed(item);
  const finished = !running && !failed;

  const moved = n.where === null && where === 'done' && wasQueued.has(item.url);
  n.item = item;
  n.where = where;

  const { li, b, cells } = n;
  const all = running ? [] : siblingsOf(item);
  n.files = byKind(all);
  // Thumbnail also for a failed job as long as the video has other files;
  // with nothing at all (e.g. wrong link) the kind icon.
  setThumb(li.querySelector('.kind'), item.url, kind, !(item.status === 'error' && !all.length), true);
  const title = li.querySelector('.title');
  title.textContent = itemTitle(item);
  const web = isWebUrl(item.url);
  if (web) title.href = item.url; else title.removeAttribute('href');
  const run = running ? progress(item, progs) : null;
  const fallbackMeta = failed ? failReason(item) : item.status === 'finished' ? 'done' : (item.msg || item.status || '');
  li.querySelector('.meta').textContent = run ? run.verb : (finished && ageText(n.files)) || fallbackMeta;
  li.querySelector('.meta').title = finished && KEEP_DAYS ? 'Files are deleted automatically ' + KEEP_DAYS + ' days after download.' : '';

  li.classList.toggle('running', running);
  li.classList.toggle('finished', finished);
  li.classList.toggle('error', failed);
  li.classList.toggle('wait', !!run && run.pct === null);
  li.querySelector('.fill').style.width = run && run.pct !== null ? Math.max(4, run.pct) + '%' : '';

  // If a job runs for a video that already has a card, the cell itself shows
  // the progress (bar at the bottom, "loading 42 %") instead of a second card
  // under "Running".
  updateFormatCells(cells, {
    busy: jobs.get(item.url) || new Map(),
    files: n.files,
    failed,
    itemKind: kind,
    panelHidden: n.panel.hidden,
    progs,
    onDone: () => { if (document.hidden) { unseen += 1; document.title = '(' + unseen + ') ' + TITLE; } },
  });

  if (web) b.open.href = item.url;
  if (failed) b.report.href = reportUrl(item, 'web');
  b.del.title = running ? 'Cancel' : 'Delete, with all formats';
  if (!n.files.captions && !n.panel.hidden) toggleTextPanel(n.panel, cells.captions, false);
  // Without a link there is nothing to request from.
  Object.values(cells).forEach((c) => { c.hidden = !web && !!item.orphan && c.dataset.state === 'missing'; });

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

// ---- Search and filter -------------------------------------------------------
// Hides and shows existing cards; nodes are never recreated. Chips combine
// with AND. The row appears only once the history is long enough to need it.
const FILTER_MIN = 6;
const filter = { q: '', on: new Set() };
const filterEl = { bar: $('filters'), nomatch: $('done-nomatch') };

function matches(n) {
  if (filter.q && !itemTitle(n.item).toLowerCase().includes(filter.q)) return false;
  for (const f of filter.on) {
    if (f === 'failed' ? !isFailed(n.item) : !n.files[f]) return false;
  }
  return true;
}

function applyFilter() {
  const active = !!filter.q || filter.on.size > 0;
  const total = el.done.children.length;
  filterEl.bar.hidden = total < FILTER_MIN && !active;
  const byLi = new Map([...nodes.values()].map((n) => [n.li, n]));
  let shown = 0;
  for (const li of el.done.children) {
    const n = byLi.get(li);
    li.hidden = !!n && active && !matches(n);
    if (!li.hidden) shown += 1;
  }
  filterEl.nomatch.hidden = !total || shown > 0;
}

$('q').addEventListener('input', (e) => { filter.q = e.target.value.trim().toLowerCase(); applyFilter(); });
document.querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => {
  const f = b.dataset.f;
  if (!filter.on.delete(f)) filter.on.add(f);
  b.setAttribute('aria-pressed', filter.on.has(f));
  applyFilter();
}));

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
    const now = Date.now();
    done.filter((i) => shouldAutoRetry(i, autoRetried, now)).forEach((i) => {
      autoRetried[i.url] = now;
      retryJob(i.url, post).catch(() => { /* the card shows "retry" */ });
    });
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
    // A YouTube job claims no files here: its orphan card (same URL) shows the
    // job in the cell, like any other card.
    const claimed = new Set(done.concat(queue.filter((i) => !ytId(i.url))).flatMap((i) => siblingsOf(i, false)));
    const titles = new Set(done.filter((i) => !siblingsOf(i, false).length).map(itemTitle));
    const orph = orphans(claimed, titles, queue.length > 0);
    orph.forEach((i) => known.add(i.url));
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
    place(el.done, build(done.concat(orph), 'done'));
    wasQueued = new Set(queue.map((i) => i.url));
    for (const [key, n] of nodes) if (!seen.has(key)) { n.li.remove(); nodes.delete(key); }
    el.active.closest('section').hidden = fresh.length === 0;
    el.doneEmpty.hidden = el.done.children.length > 0;
    applyFilter();
    lastDone = done;
    lastOrphans = orph;
    clear.btn.hidden = !done.length && !orph.length;
    if (clear.btn.hidden) clear.bar.hidden = true;
  } catch (e) {
    setConn(false);
    if (e.message) el.conn.title = e.message;
  }
}

// ---- Clear all ---------------------------------------------------------------
// Removes every finished entry from the history, optionally with all files of
// all formats. Running jobs are left alone. Files without a history entry
// go only with "Delete files too".

const clear = { btn: $('clearall'), bar: $('clearbar'), q: $('clearq') };
let lastDone = [];
let lastOrphans = [];

clear.btn.addEventListener('click', () => {
  const n = lastDone.length;
  const o = lastOrphans.length;
  const entries = (k) => k + (k === 1 ? ' entry' : ' entries');
  clear.q.textContent = n
    ? 'Clear ' + entries(n) + ' from the history' + (filter.q || filter.on.size ? ' (filters ignored)' : '') + '?' + (o ? ' "Delete files too" also deletes ' + entries(o) + ' without history.' : '')
    : 'Delete the files of ' + entries(o) + ' without history?';
  $('clear-history').hidden = !n;
  clear.bar.hidden = false;
  $('clear-cancel').focus();
});
$('clear-cancel').addEventListener('click', () => { clear.bar.hidden = true; });

async function clearAll(withFiles) {
  const items = lastDone.slice();
  const extra = withFiles ? lastOrphans.flatMap((i) => i.orphan) : [];
  const buttons = clear.bar.querySelectorAll('button');
  buttons.forEach((x) => { x.disabled = true; });
  try {
    listingsAt = 0;
    await loadListings(items);
    const files = withFiles ? items.flatMap((i) => siblingsOf(i)).concat(extra) : [];
    if (items.length) {
      const res = await post('/delete', { ids: items.map((i) => i.url), where: 'done', delete_files: withFiles && !TRASH_DAYS });
      if (res && res.status === 'error') throw new Error(res.msg || 'MeTube refused.');
    }
    const gone = withFiles ? await removeFiles(files) : [];
    items.forEach((i) => { delete stems[i.url]; });
    saveStems();
    if (gone.includes(false)) throw new Error('some files could not be ' + (TRASH_DAYS ? 'moved.' : 'deleted.'));
    toast(withFiles ? (TRASH_DAYS ? (items.length ? 'History cleared, files' : 'Files') + ' moved to the trash.' : 'History and files deleted.') : 'History cleared. The files stay and are still listed.');
    clear.bar.hidden = true;
  } catch (e) {
    toast('That did not work: ' + e.message, true);
  } finally {
    buttons.forEach((x) => { x.disabled = false; });
    listingsAt = 0;
    refresh();
    loadTrash();
  }
}
$('clear-files').addEventListener('click', () => clearAll(true));
$('clear-history').addEventListener('click', () => clearAll(false));

// ---- Trash -----------------------------------------------------------------
// Lists /files/.trash/<unix time>/..., one entry per video (same grouping as
// orphans()). Restore moves the files back; they show up as cards again
// (with or without history, see orphans()). Not polled: loaded at start, when
// opened and after each action.

const trashEl = { box: $('trash'), count: $('trash-count'), list: $('trash-list'), empty: $('trash-empty'), btn: $('trash-purge') };
let trashGroups = [];

async function listDir(path) {
  const res = await fetch('/files/' + path, { signal: AbortSignal.timeout(5000) });
  noteServerTime(res);
  if (res.status === 404) return [];
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

// All files below a trash folder: [{ rel (below the time folder), stamp }].
async function trashFilesOf(stamp, sub) {
  const out = [];
  for (const f of await listDir('.trash/' + stamp + '/' + (sub ? encPath(sub) + '/' : ''))) {
    const rel = (sub ? sub + '/' : '') + f.name;
    if (f.type === 'directory') out.push(...await trashFilesOf(stamp, rel));
    else if (f.type === 'file') out.push({ rel, stamp });
  }
  return out;
}

async function loadTrash() {
  if (!TRASH_DAYS) return;
  try {
    const stamps = (await listDir('.trash/')).filter((f) => f.type === 'directory' && /^\d{9,11}$/.test(f.name));
    const files = (await Promise.all(stamps.map((f) => trashFilesOf(f.name)))).flat();
    const groups = new Map();
    for (const { rel, stamp } of files) {
      const [dir, name] = splitPath(rel);
      const s = stem(name);
      if (!Object.keys(byKind([rel]))[0]) continue;
      const id = (s.match(/\[([\w-]{11})\]$/) || [])[1];
      const key = stamp + '|' + (dir ? dir + '/' : '') + (id ? '[' + id + ']' : s);
      if (!groups.has(key)) groups.set(key, { title: s.replace(/\s*\[[\w-]{11}\]$/, ''), stamp: Number(stamp), files: [] });
      groups.get(key).files.push(rel);
    }
    trashGroups = [...groups.values()].sort((a, b) => b.stamp - a.stamp);
    renderTrash();
  } catch (_) { /* keep the old list */ }
}

function trashLeft(stamp) {
  const day = 86400000;
  const left = Math.ceil((stamp * 1000 + TRASH_DAYS * day - serverNow()) / day);
  return left <= 1 ? 'removed for good soon' : 'removed for good in ' + left + ' days';
}

function renderTrash() {
  trashEl.count.textContent = trashGroups.length ? '(' + trashGroups.length + ')' : '';
  trashEl.empty.hidden = trashGroups.length > 0;
  trashEl.btn.hidden = !trashGroups.length;
  trashEl.list.replaceChildren(...trashGroups.map((g) => {
    const li = document.createElement('li');
    li.className = 'item trashed';
    li.innerHTML = '<div class="text"><span class="title"></span><div class="meta"></div></div>' +
      '<button type="button" class="btn">Restore</button>';
    li.querySelector('.title').textContent = g.title;
    const kinds = Object.keys(byKind(g.files)).map((k) => LABEL[k]).join(', ');
    li.querySelector('.meta').textContent = kinds + ' · ' + trashLeft(g.stamp);
    li.querySelector('button').addEventListener('click', (e) => restore(g, e.currentTarget));
    return li;
  }));
}

async function restore(g, button) {
  button.disabled = true;
  try {
    const res = await Promise.all(g.files.map((rel) => moveFile('.trash/' + g.stamp + '/' + rel, rel, true)));
    if (res.includes('exists')) throw new Error('a file with the same name is already in the download folder.');
    if (res.includes('fail')) throw new Error('not all files could be restored.');
    toast('Restored.');
  } catch (e) {
    toast('Restore did not work: ' + e.message, true);
  } finally {
    listingsAt = 0;
    await loadTrash();
    refresh();
  }
}

// "Empty trash" asks first: the first tap changes the label, the second
// deletes for good. Back to normal after 4 s.
let purgeTimer = null;
trashEl.btn.addEventListener('click', async () => {
  if (!trashEl.btn.classList.contains('armed')) {
    trashEl.btn.classList.add('armed');
    trashEl.btn.textContent = 'Delete for good?';
    purgeTimer = setTimeout(disarmPurge, 4000);
    return;
  }
  clearTimeout(purgeTimer);
  trashEl.btn.disabled = true;
  try {
    const files = trashGroups.flatMap((g) => g.files.map((rel) => '.trash/' + g.stamp + '/' + rel));
    if ((await deleteFiles(files)).includes(false)) throw new Error('not all files could be deleted.');
    toast('Trash emptied.');
  } catch (e) {
    toast('That did not work: ' + e.message, true);
  } finally {
    trashEl.btn.disabled = false;
    disarmPurge();
    loadTrash();
  }
});
function disarmPurge() {
  trashEl.btn.classList.remove('armed');
  trashEl.btn.textContent = 'Empty trash';
}

if (TRASH_DAYS) {
  $('trash-days').textContent = TRASH_DAYS + (TRASH_DAYS === 1 ? ' day' : ' days');
  trashEl.box.hidden = false;
  trashEl.box.addEventListener('toggle', () => { if (trashEl.box.open) loadTrash(); });
}

// ---- Download settings -------------------------------------------------------

const prefs = (() => {
  try { return normalizePrefs(JSON.parse(localStorage.getItem('prefs'))); } catch (_) { return normalizePrefs(null); }
})();
Object.keys(PREF_OPTIONS).forEach((k) => {
  const sel = $('pref-' + k);
  PREF_OPTIONS[k].forEach(([v, t]) => sel.add(new Option(t, v)));
  sel.value = prefs[k];
  sel.addEventListener('change', () => {
    prefs[k] = sel.value;
    try { localStorage.setItem('prefs', JSON.stringify(prefs)); } catch (_) { /* ignore */ }
  });
});

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
loadTrash();
// Poll less often in the background, but keep going so the tab counter works.
let tick = 0;
setInterval(() => { tick += 1; if (!document.hidden || tick % 5 === 0) refresh(); }, POLL_MS);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  unseen = 0;
  document.title = TITLE;
  refresh();
});
