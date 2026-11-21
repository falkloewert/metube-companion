'use strict';

// Extension popup, same interaction as the web UI (web/app.js): tap a tile
// once to select, tap again to send. Below it the last sent video with the
// same format bar (Video, Audio, Text, Image). The shared parts (formats,
// progress, icons) live in shared.js.

const $ = (id) => document.getElementById(id);
const urlInput = $('url');
const status = $('status');
const tiles = $('tiles');
const job = $('job');
const jobKind = $('jobkind');
const jobTitle = $('jobtitle');
const jobMeta = $('jobmeta');
const formats = $('formats');
const panel = $('textpanel');

// Desktop setup default; other instances are set on the options page, which
// also asks for the host permission (optional_host_permissions).
const DEFAULT_BASE = 'http://localhost:8081';
const LABEL = Object.fromEntries(FORMATS.map((f) => [f.kind, f.label]));

tiles.querySelectorAll('.tile').forEach((t) => {
  t.insertAdjacentHTML('afterbegin', ICON[t.dataset.kind].replace('<svg', '<svg class="ico"') + SPIN + CHECK('check'));
  t.insertAdjacentHTML('beforeend',
    '<span class="ask">tap again</span><span class="busytxt">sending …</span><span class="donetxt">sent</span>');
});
$('copy').insertAdjacentHTML('afterbegin', ICON.copy + CHECK('tick'));
$('md').insertAdjacentHTML('afterbegin', ICON.md + CHECK('tick'));

function setStatus(text, bad) {
  status.textContent = text;
  status.classList.toggle('err', !!bad);
}

async function getBase() {
  const { base } = await browser.storage.local.get('base');
  return (base || DEFAULT_BASE).replace(/\/+$/, '');
}

// Optional access token of a protected instance (COMPANION_TOKEN), sent as a
// header with every request to the instance.
async function authHeaders() {
  const { token } = await browser.storage.local.get('token');
  return token ? { 'X-Companion-Token': token } : {};
}

async function ifetch(url, init = {}) {
  const headers = Object.assign({}, init.headers, await authHeaders());
  return fetch(url, Object.assign({ credentials: 'include' }, init, { headers }));
}

async function downloadHeaders() {
  return Object.entries(await authHeaders()).map(([name, value]) => ({ name, value }));
}

const enc = (rel) => rel.split('/').map(encodeURIComponent).join('/');

browser.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
  // Never suggest the MeTube page itself (e.g. the extension download).
  const own = (await getBase()) + '/';
  if (tab && /^https?:/i.test(tab.url || '') && !tab.url.startsWith(own)) urlInput.value = tab.url;
  // With a prefilled link the tiles take focus; if empty, paste right away.
  if (!urlInput.value) urlInput.focus();
}).catch(() => {});
// Focusing the field selects everything, so pasting replaces the old link.
urlInput.addEventListener('focus', () => urlInput.select());

// ---- Tiles: first tap selects, second sends ---------------------------------

let armed = null;
let armTimer = null;
let sending = false;

const tile = (kind) => tiles.querySelector('[data-kind="' + kind + '"]');

function disarm() {
  clearTimeout(armTimer);
  if (armed && status.textContent.endsWith('again to start.')) setStatus('');
  armed = null;
  tiles.classList.remove('armed');
  tiles.querySelectorAll('.tile').forEach((t) => t.classList.remove('armed'));
}

function arm(kind) {
  disarm();
  armed = kind;
  tiles.classList.add('armed');
  tile(kind).classList.add('armed');
  armTimer = setTimeout(disarm, 4000);
}

function burst(el) {
  for (let i = 0; i < 12; i++) {
    const s = document.createElement('span');
    const size = 3 + Math.random() * 3;
    s.className = 'burst';
    s.style.width = s.style.height = size + 'px';
    s.style.setProperty('--a', (i * 30 + (Math.random() * 20 - 10)) + 'deg');
    s.style.setProperty('--d', -(22 + Math.random() * 14) + 'px');
    el.appendChild(s);
  }
  setTimeout(() => el.querySelectorAll('.burst').forEach((s) => s.remove()), 700);
}

tiles.addEventListener('click', (e) => {
  const t = e.target.closest('.tile');
  if (!t || sending) return;
  const url = urlInput.value.trim();
  if (!url) {
    urlInput.classList.remove('shake');
    void urlInput.offsetWidth;
    urlInput.classList.add('shake');
    urlInput.focus();
    setStatus('Paste a link first.', true);
    return;
  }
  if (armed !== t.dataset.kind) {
    arm(t.dataset.kind);
    setStatus('Tap "' + LABEL[t.dataset.kind] + '" again to start.');
    return;
  }
  send(url, t.dataset.kind, t);
});

document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && armed) { e.preventDefault(); disarm(); } });
document.addEventListener('click', (e) => { if (armed && !e.target.closest('.tile')) disarm(); });

function send(url, kind, t) {
  disarm();
  sending = true;
  tiles.classList.add('sending');
  t.classList.add('busy');
  setStatus(kind === 'captions' ? 'Detecting language …' : 'Sending …');
  browser.runtime.sendMessage({ type: 'send', url, kind }).then((res) => {
    t.classList.remove('busy');
    if (!res || !res.ok) throw new Error((res && res.message) || 'That did not work.');
    t.classList.add('done');
    burst(t);
    const lang = res.lang ? ', text in ' + (res.lang === 'en' ? 'English' : 'German') : '';
    setStatus((res.withCookies ? 'Sent, with cookies' : 'Sent, without cookies') + lang + '.');
    urlInput.value = '';
    watch(res.url || url);
    setTimeout(() => { t.classList.remove('done'); tiles.classList.remove('sending'); sending = false; }, 1300);
  }).catch((e) => {
    t.classList.remove('busy');
    t.classList.add('fail');
    setStatus(e.message || 'That did not work.', true);
    setTimeout(() => { t.classList.remove('fail'); tiles.classList.remove('sending'); sending = false; }, 600);
  });
}

// ---- Last video with format bar ----------------------------------------------

const cells = {};
for (const f of FORMATS) {
  const c = document.createElement('button');
  c.type = 'button';
  c.className = 'fmt';
  c.dataset.kind = f.kind;
  c.innerHTML = ICON[f.kind] + SPIN + CHECK('tick') + '<span class="lbl">' + f.label + '</span><span class="verb"></span>';
  formats.appendChild(c);
  cells[f.kind] = c;
}

let lastUrl = null;
let jobTimer = null;
let refreshing = false;
let item = null;              // history entry of the video (last job)
let files = {};               // kind -> relative path of the existing file
let text = null;              // { rel, promise } for preview, copy, .md
const progs = new Map();

function setVerb(c, verb) {
  const label = LABEL[c.dataset.kind];
  c.querySelector('.verb').textContent = verb;
  c.title = verb === 'waiting' ? label + ': only when the running job is done' : label + ' ' + verb;
  c.setAttribute('aria-label', c.title);
}

function flash(btn) {
  btn.classList.remove('flash');
  void btn.offsetWidth;
  btn.classList.add('flash');
  setTimeout(() => btn.classList.remove('flash'), 900);
}

// Why the instance does not answer: protected (token missing or wrong) or
// not reachable at all.
async function unreachable() {
  const base = await getBase();
  try {
    const r = await ifetch(base + '/ext/history');
    if (r.status === 401) return 'This instance is protected. Enter its access token in Settings.';
  } catch (_) { /* not reachable */ }
  return 'Cannot reach ' + base + '. Check the address in Settings and your network or VPN.';
}

async function refreshJob() {
  if (!lastUrl || refreshing) return;
  refreshing = true;
  try {
    const base = await getBase();
    const res = await ifetch(base + '/ext/history');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const h = await res.json();
    const done = (h.done || []).find((i) => i.url === lastUrl) || null;
    const running = new Map();
    for (const i of [].concat(h.queue || [], h.pending || [])) {
      if (i.url === lastUrl) running.set(i.download_type || 'video', i);
    }
    // File list as in the web UI: which formats already exist.
    const listings = new Map();
    const dirs = new Set(['']);
    if (done && done.filename) dirs.add(splitPath(relPath(done.filename))[0]);
    await Promise.all([...dirs].map(async (dir) => {
      try {
        const r = await ifetch(base + '/files/' + (dir ? enc(dir) + '/' : ''));
        if (r.ok) listings.set(dir, parseListing(await r.json()));
      } catch (_) { /* no list: carry on without siblings */ }
    }));
    let stemBase = null;
    if (done && done.filename) {
      const [dir, name] = splitPath(relPath(done.filename));
      stemBase = (dir ? dir + '/' : '') + stem(name);
    }
    render(done, running, byKind(siblings(done || { url: lastUrl }, listings, stemBase)));
  } catch (_) {
    job.hidden = true;
    if (!status.textContent) setStatus(await unreachable(), true);
  } finally {
    refreshing = false;
  }
}

function render(done, running, found) {
  if (!done && !running.size) { job.hidden = true; return; }
  job.hidden = false;
  item = done || running.values().next().value;
  files = found;
  const kind = item.download_type || 'video';
  const failed = !!done && !running.size && (done.status === 'error' || (done.status === 'finished' && !done.filename));
  const first = running.values().next().value;
  const run = first ? progress(first, progs) : null;

  const thumb = failed && !Object.keys(files).length ? null : thumbFor(lastUrl);
  const look = thumb || kind;
  if (jobKind.dataset.look !== look) {
    jobKind.dataset.look = look;
    jobKind.classList.toggle('thumb', !!thumb);
    jobKind.innerHTML = thumb ? '<img alt="" referrerpolicy="no-referrer">' : (ICON[kind] || ICON.video);
    if (thumb) jobKind.firstChild.src = thumb;
  }
  jobTitle.textContent = item.title || lastUrl;
  jobTitle.dataset.url = item.url || '';
  job.classList.toggle('error', failed);
  const report = $('report');
  report.hidden = !failed;
  if (failed) report.href = reportUrl(done, 'extension');
  jobMeta.textContent = run ? LABEL[first.download_type || 'video'] + ': ' + run.verb
    : failed ? friendlyError(done.msg || done.error || (kind === 'captions' ? 'no text found' : 'no file'))
      : 'stored on the server';

  for (const f of FORMATS) {
    const c = cells[f.kind];
    // After a tap the cell stays on "starting" until MeTube has accepted the
    // job and it appears in the list.
    const pending = c.dataset.inflight === '1' || c.dataset.sent > Date.now() - 4000;
    if (c.dataset.state === 'busy' && !running.has(f.kind) && !files[f.kind] && pending) continue;
    const state = running.has(f.kind) ? 'busy' : files[f.kind] ? 'have' : running.size ? 'blocked' :
      failed && kind === f.kind ? 'fail' : 'missing';
    const was = c.dataset.state;
    c.dataset.state = state;
    let verb = state === 'have' && f.kind === 'captions' ? (panel.hidden ? 'show' : 'hide') : VERBS[state];
    const r = running.has(f.kind) ? progress(running.get(f.kind), progs) : null;
    c.classList.toggle('wait', !!r && r.pct === null);
    c.style.setProperty('--p', (r && r.pct !== null ? Math.max(4, r.pct) : 0) + '%');
    if (r) verb = r.verb;
    if (!c.classList.contains('cancel') && c.querySelector('.verb').textContent !== verb) setVerb(c, verb);
    if (was === 'busy' && state === 'have') {
      c.classList.add('finishing');
      setTimeout(() => { c.classList.remove('finishing'); flash(c); }, 450);
    }
  }
  if (!files.captions && !panel.hidden) toggleText(false);
}

function watch(url) {
  if (url !== lastUrl) { toggleText(false); text = null; progs.clear(); }
  lastUrl = url;
  browser.storage.local.set({ last: { url } });
  if (!jobTimer) jobTimer = setInterval(refreshJob, 2000);
  refreshJob();
}

// ---- Format cells: save, show text, request, retry ---------------------------

async function fileUrl(rel) {
  return (await getBase()) + '/ext/download/' + enc(rel);
}

async function textOf() {
  const rel = files.captions;
  if (!text || text.rel !== rel) {
    const promise = (async () => {
      const res = await ifetch(await fileUrl(rel));
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return cleanTranscript(await res.text());
    })();
    promise.catch(() => { text = null; });
    text = { rel, promise };
  }
  return text.promise;
}

function toggleText(open) {
  const c = cells.captions;
  panel.hidden = !open;
  c.classList.toggle('open', open);
  if (c.dataset.state === 'have') setVerb(c, open ? 'hide' : 'show');
  if (!open) return;
  const preview = panel.querySelector('.preview');
  const head = panel.querySelector('.tp-head');
  head.textContent = 'Preview';
  preview.textContent = 'Loading text …';
  preview.classList.add('loading');
  textOf().then((t) => {
    preview.textContent = t || 'The text is empty.';
    head.textContent = 'Preview · ' + (t ? t.split(' ').length : 0).toLocaleString() + ' words';
  }, (e) => { preview.textContent = 'Could not load text: ' + e.message; })
    .finally(() => preview.classList.remove('loading'));
}

formats.addEventListener('click', async (e) => {
  const c = e.target.closest('.fmt');
  if (!c || !item) return;
  const kind = c.dataset.kind;
  const state = c.dataset.state;
  if (state === 'blocked' || c.dataset.inflight === '1') return;
  // A running format is cancelled by tapping its cell twice.
  if (state === 'busy') {
    if (!c.classList.contains('cancel')) {
      c.classList.add('cancel');
      setVerb(c, 'tap to cancel');
      setTimeout(() => c.classList.remove('cancel'), 4000);
      return;
    }
    c.classList.remove('cancel');
    try {
      const r = await ifetch((await getBase()) + '/ext/delete', {
        method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify({ ids: [lastUrl], where: 'queue' })
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      setStatus('Cancelled.');
    } catch (err) {
      setStatus('Cancel did not work: ' + err.message, true);
    }
    refreshJob();
    return;
  }
  if (state === 'have') {
    if (kind === 'captions') { toggleText(panel.hidden); return; }
    await browser.downloads.download({ url: await fileUrl(files[kind]), saveAs: false, headers: await downloadHeaders() });
    flash(c);
    setStatus(LABEL[kind] + ': download started.');
    return;
  }
  c.dataset.state = 'busy';
  c.dataset.inflight = '1';
  c.classList.add('wait');
  setVerb(c, 'starting …');
  try {
    if (state === 'fail' && item.status === 'error') {
      // Errors go through MeTube's /retry: keeps the options (language,
      // preset); the old entry is removed only afterwards.
      const base = await getBase();
      const opts = (body) => ({
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify(body)
      });
      const r = await (await ifetch(base + '/ext/retry', opts({ id: item.url }))).json();
      if (r && r.status === 'error') throw new Error(r.msg || 'Retry failed.');
      await ifetch(base + '/ext/delete', opts({ ids: [item.url], where: 'done' }));
    } else {
      const res = await browser.runtime.sendMessage({ type: 'send', url: lastUrl, kind });
      if (!res || !res.ok) throw new Error((res && res.message) || 'That did not work.');
    }
    c.dataset.sent = Date.now();
    setStatus(LABEL[kind] + ' is loading.');
    setTimeout(refreshJob, 600);
  } catch (err) {
    c.classList.remove('wait');
    c.dataset.state = state;
    setVerb(c, VERBS[state]);
    setStatus(err.message || 'That did not work.', true);
  } finally {
    delete c.dataset.inflight;
  }
});

$('copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(await textOf());
    flash($('copy'));
    setStatus('Text copied.');
  } catch (e) {
    setStatus('Copy failed: ' + e.message, true);
  }
});

$('md').addEventListener('click', async () => {
  try {
    const title = jobTitle.textContent || 'Transcript';
    const md = '# ' + title + '\n\nSource: ' + (jobTitle.dataset.url || '') + '\n\n' + (await textOf()) + '\n';
    const url = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
    const name = title.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 120) || 'Transcript';
    await browser.downloads.download({ url, filename: name + '.md', saveAs: false });
    flash($('md'));
    setStatus('Saved as .md.');
  } catch (e) {
    setStatus('Download failed: ' + e.message, true);
  }
});

jobTitle.addEventListener('click', (e) => {
  e.preventDefault();
  const url = jobTitle.dataset.url;
  if (isWebUrl(url)) browser.tabs.create({ url });
});

$('options').addEventListener('click', (e) => {
  e.preventDefault();
  browser.runtime.openOptionsPage();
});

// To the web UI with the full history.
$('home').addEventListener('click', async (e) => {
  e.preventDefault();
  browser.tabs.create({ url: (await getBase()) + '/' });
});

$('ver').textContent = 'v' + browser.runtime.getManifest().version;

// Tell right away when the instance is not reachable (wrong address,
// not on the home network or VPN, missing permission).
getBase().then((base) => fetch(base + '/healthz').then((r) => { if (!r.ok) throw new Error(); }))
  .catch(async () => setStatus(await unreachable(), true));

// After opening, keep showing the last video (also if the context menu
// started it).
browser.storage.local.get('last').then(({ last }) => {
  if (last && last.url) watch(last.url);
}).catch(() => {});
