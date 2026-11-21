'use strict';

// Shared by the web UI (web/app.js) and the browser extension
// (extension/popup.js, background.js). Top section is pure (safe in the
// extension service worker); the DOM helpers at the bottom are only called by
// web/app.js and extension/popup.js. Copied into the extension by build.sh.

// Bump together with the extension manifests on every release.
const COMPANION_VERSION = '0.2.0';
const ISSUES_URL = 'https://github.com/falkloewert/metube-companion/issues/new';

// Prefilled bug report. Opens GitHub in the browser; nothing is sent until
// the user submits it there, so they can remove the link if it is private.
function reportUrl(info, where) {
  const lines = [
    '**What happened**',
    '',
    '<!-- describe what you did and what you expected -->',
    '',
    '**Details**',
    '',
    '- MeTube Companion: ' + COMPANION_VERSION + ' (' + where + ')',
    '- Format: ' + ((info && info.download_type) || 'unknown'),
    '- Status: ' + ((info && info.status) || 'unknown'),
    '- MeTube message: ' + ((info && (info.msg || info.error)) || 'none'),
    '- Link: ' + ((info && info.url) || 'unknown') + ' (remove if private)',
  ];
  return ISSUES_URL + '?labels=bug&title=' + encodeURIComponent('Download fails: ' + ((info && info.title) || 'short description')) +
    '&body=' + encodeURIComponent(lines.join('\n'));
}

const ICON = {
  video: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10 9.5v5l4.5-2.5z"/></svg>',
  audio: '<svg viewBox="0 0 24 24"><path d="M9 18V6l11-2v12"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>',
  captions: '<svg viewBox="0 0 24 24"><path d="M4 6h16M4 10h16M4 14h11M4 18h7"/></svg>',
  md: '<svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M12 11v6m-2.5-2.5L12 17l2.5-2.5"/></svg>',
  copy: '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/></svg>',
  report: '<svg viewBox="0 0 24 24"><path d="M5 21V4m0 0h11l-2 4 2 4H5"/></svg>',
  open: '<svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/></svg>',
  thumbnail: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/></svg>',
  del: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>',
};
const SPIN = '<svg class="spin" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" stroke-dasharray="36 52"/></svg>';
const CHECK = (cls) => '<svg class="' + cls + '" viewBox="0 0 24 24"><path pathLength="1" d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

const PAYLOADS = {
  video: { download_type: 'video', codec: 'auto', format: 'any', quality: 'best' },
  audio: { download_type: 'audio', format: 'm4a', quality: 'best', audio_tags: 'with_cover' },
  // Plain text without timestamps, language from langFromWatchPage().
  // prefer_auto fetches the original track ("en-orig") first, then the normal
  // one. The "text" preset (MeTube YTDL_OPTIONS_PRESETS) turns a failed track
  // (YouTube: often 429) into a warning instead of an error.
  captions: {
    download_type: 'captions', format: 'txt', quality: 'best',
    subtitle_mode: 'prefer_auto', ytdl_options_presets: ['text'],
  },
  thumbnail: { download_type: 'thumbnail', format: 'jpg', quality: 'best' },
};

// Optional choices (values are MeTube's own, see GET /formats). Defaults equal
// the tiles' original behavior. Stored per browser (web) or in the extension.
const PREF_OPTIONS = {
  videoQuality: [['best', 'Best'], ['1080', '1080p'], ['720', '720p'], ['480', '480p']],
  audioFormat: [['m4a', 'M4A'], ['mp3', 'MP3'], ['opus', 'Opus']],
};
const PREF_DEFAULTS = { videoQuality: 'best', audioFormat: 'm4a' };

function normalizePrefs(raw) {
  const out = Object.assign({}, PREF_DEFAULTS);
  Object.keys(PREF_OPTIONS).forEach((k) => {
    if (raw && PREF_OPTIONS[k].some(([v]) => v === raw[k])) out[k] = raw[k];
  });
  return out;
}

// Body for MeTube's /add (without url and language): PAYLOADS plus the prefs.
function buildPayload(kind, prefs) {
  const p = normalizePrefs(prefs);
  const body = Object.assign({}, PAYLOADS[kind] || PAYLOADS.video);
  if (kind === 'video') body.quality = p.videoQuality;
  if (kind === 'audio') body.format = p.audioFormat;
  return body;
}

const FORMATS = [
  { kind: 'video', label: 'Video', ext: /^(mp4|webm|mkv|mov)$/i },
  { kind: 'audio', label: 'Audio', ext: /^(m4a|mp3|opus|ogg|wav|flac)$/i },
  { kind: 'captions', label: 'Text', ext: /^[\w-]+\.txt$/i },
  { kind: 'thumbnail', label: 'Image', ext: /^(jpe?g|webp|png)$/i },
];
const LABEL = Object.fromEntries(FORMATS.map((f) => [f.kind, f.label]));

const VERBS = { have: 'save', missing: 'request', busy: 'loading …', fail: 'retry', blocked: 'waiting' };

function encPath(rel) {
  return rel.split('/').map(encodeURIComponent).join('/');
}

function ytId(url) {
  try {
    const u = new URL(url);
    let id = null;
    if (/(^|\.)youtu\.be$/.test(u.hostname)) id = u.pathname.slice(1).split('/')[0];
    else if (/(^|\.)youtube\.com$/.test(u.hostname)) {
      id = u.searchParams.get('v') || (u.pathname.match(/^\/(?:shorts|live|embed)\/([^/]+)/) || [])[1];
    }
    return id && /^[\w-]{11}$/.test(id) ? id : null;
  } catch (_) { /* not a link */ }
  return null;
}

// Real web links only: MeTube also keeps rejected input (e.g. javascript:)
// in its history, which must never end up as an href.
function isWebUrl(url) {
  try { return /^https?:$/.test(new URL(url).protocol); } catch (_) { return false; }
}

// MeTube tracks YouTube jobs as watch?v=<id>.
function canonical(url) {
  const id = ytId(url);
  return id ? 'https://www.youtube.com/watch?v=' + id : url;
}

function thumbFor(url) {
  const id = ytId(url);
  return id ? 'https://i.ytimg.com/vi/' + id + '/mqdefault.jpg' : null;
}

// Spoken language from the YouTube watch page, in this order:
// 1. Audio tracks: for AI-dubbed videos the original is the track without
//    "isAutoDubbed" (the default track is often the German dub).
// 2. The only automatic caption track ("kind":"asr").
// 3. Manual captions, German before English.
// English stays English, anything else becomes German (YouTube translates).
function langFromWatchPage(html) {
  const pick = (lang) => (/^en\b/.test(lang || '') ? 'en' : 'de');

  const audio = (html.match(/"audioTrack":\{[^}]*\}/g) || [])
    .filter((t) => !t.includes('"isAutoDubbed":true'))
    .map((t) => ((t.match(/"id":"([^".]+)/) || [])[1] || ''));
  if (audio.length && audio[0]) return pick(audio[0]);

  const start = html.indexOf('"captionTracks":[');
  if (start < 0) return 'de';
  const tracks = html.slice(start, html.indexOf('"audioTracks"', start)).split('{"baseUrl"').slice(1)
    .map((t) => ({ lang: (t.match(/"languageCode":"([^"]+)"/) || [])[1] || '', asr: t.includes('"kind":"asr"') }));
  const asr = tracks.filter((t) => t.asr);
  if (asr.length === 1) return pick(asr[0].lang);
  const de = tracks.some((t) => !t.asr && t.lang.startsWith('de'));
  const en = tracks.some((t) => !t.asr && t.lang.startsWith('en'));
  if (de && en) return wordsLang(html);
  return en ? 'en' : 'de';
}

// German and English manual captions, nothing else to go by (old videos
// without an automatic track): one of them is a translation. Title and
// description tell which language the uploader wrote in.
// ponytail: stopword count, two languages only; replace when #15 brings any
// language.
function wordsLang(html) {
  const details = html.slice(Math.max(0, html.indexOf('"videoDetails":')));
  const field = (k) => ((details.match(new RegExp('"' + k + '":"((?:[^"\\\\]|\\\\.)*)"')) || [])[1] || '');
  const text = (field('title') + ' ' + field('shortDescription')).toLowerCase();
  const count = (words) => (text.match(new RegExp('\\b(?:' + words + ')\\b', 'g')) || []).length;
  const de = count('der|die|das|und|ist|nicht|mit|ich|ein|eine|im|auf|wie|zu|den|von') + (/[äöüß]/.test(text) ? 2 : 0);
  const en = count('the|and|is|not|with|i|a|an|in|on|how|to|of|at|me|my|this');
  return en > de ? 'en' : 'de';
}

// Errors go through MeTube's /retry: keeps the options (language, preset).
// postJson(path, body) posts to MeTube ("/retry", "/delete").
async function retryJob(url, postJson) {
  const res = await postJson('/retry', { id: url });
  if (res && res.status === 'error') throw new Error(res.msg || 'Retry failed.');
  await postJson('/delete', { ids: [url], where: 'done' });
}

// YouTube's 403 mostly passes on the next try (about 1 in 15 downloads in
// tests, retry worked each time): retry once per URL within 10 minutes,
// without asking. retried: URL -> time of the last automatic retry.
// ponytail: only while the web UI or the extension watches the job; move to
// a server-side helper if that is not enough.
const AUTO_RETRY_MS = 600000;
function shouldAutoRetry(item, retried, now) {
  return item.status === 'error' && /HTTP Error 403|Forbidden/i.test(item.msg || item.error || '') &&
    !(retried[item.url] && now - retried[item.url] < AUTO_RETRY_MS);
}

function friendlyError(msg) {
  const m = String(msg || '');
  if (/429|Too Many Requests/i.test(m)) return 'YouTube is blocking requests right now (too many). Try again later.';
  if (/cookies are no longer valid/i.test(m)) return 'The stored YouTube cookies have expired. Send once via the extension (it sends fresh ones) or remove them under "Cookies".';
  if (/HTTP Error 403|Forbidden/i.test(m)) return 'YouTube refused the download (403). Usually temporary: tap retry.';
  if (/Sign in to confirm/i.test(m)) return 'YouTube wants a sign-in. Send cookies via the extension and try again.';
  if (/private|unavailable/i.test(m)) return 'Video is private or unavailable.';
  return m.replace(/^ERROR:\s*/i, '') || 'Error';
}

function isFailed(item) {
  return !!item && (item.status === 'error' || (item.status === 'finished' && !item.filename));
}

function failReason(item) {
  if (item && item.status === 'finished' && !item.filename) {
    return item.download_type === 'captions' ? 'no text found' : 'no file';
  }
  return friendlyError(item && (item.msg || item.error));
}

function checkAddResult(res) {
  if (res && res.status === 'error') throw new Error(res.msg || 'MeTube rejected the request.');
  if (res && /already/i.test(res.msg || '')) throw new Error('Already running.');
}

function relPath(filename) {
  return String(filename).replace(/^\/downloads\//, '').replace(/^\/+/, '');
}

function splitPath(rel) {
  const i = rel.lastIndexOf('/');
  return i < 0 ? ['', rel] : [rel.slice(0, i), rel.slice(i + 1)];
}

// Name stem of a file: "Title.en.txt" -> "Title", "Title.mp4" -> "Title".
function stem(name) {
  return /\.[\w-]+\.txt$/i.test(name) ? name.replace(/\.[\w-]+\.txt$/i, '') : name.replace(/\.[^.]+$/, '');
}

// File list from nginx (/files/, autoindex JSON) -> Map file name -> time.
function parseListing(json) {
  return new Map(json.filter((f) => f.type === 'file').map((f) => [f.name, Date.parse(f.mtime)]));
}

// All files of an entry (relative paths); byKind() picks the first per kind.
// base: name stem of the last job's file ("folder/Title [id]"), or null.
// listings: Map folder -> Map file name -> mtime (from parseListing).
function siblings(item, listings, base) {
  const isFormat = (name) => FORMATS.some((f) => f.ext.test(name.slice(stem(name).length + 1)));
  const found = new Set();
  if (base) {
    const [dir, b] = splitPath(base);
    for (const name of (listings.get(dir) || new Map()).keys()) {
      if (name.startsWith(b + '.') && isFormat(name)) found.add((dir ? dir + '/' : '') + name);
    }
  }
  // YouTube: with an OUTPUT_TEMPLATE containing [%(id)s] the video ID is in
  // the file name. This finds the formats even without a stem (failed last
  // job, another browser without localStorage).
  const id = ytId(item.url);
  if (id) {
    for (const [dir, names] of listings) {
      for (const name of names.keys()) {
        if (stem(name).endsWith('[' + id + ']') && isFormat(name)) found.add((dir ? dir + '/' : '') + name);
      }
    }
  }
  return [...found];
}

function byKind(paths) {
  const out = {};
  for (const rel of paths) {
    const name = splitPath(rel)[1];
    const f = FORMATS.find((x) => x.ext.test(name.slice(stem(name).length + 1)));
    if (f && !out[f.kind]) out[f.kind] = rel;
  }
  return out;
}

// Captions arrive line by line; they read better as running text.
// Automatic tracks repeat lines, those are dropped.
function cleanTranscript(raw) {
  const lines = String(raw).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return lines.filter((l, i) => l !== lines[i - 1]).join(' ').replace(/\s+/g, ' ');
}

function transcriptMd(title, url, text) {
  const safe = title || 'Transcript';
  const md = '# ' + safe + '\n\nSource: ' + (url || '') + '\n\n' + text + '\n';
  const filename = (safe.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 120) || 'Transcript') + '.md';
  return { blob: new Blob([md], { type: 'text/markdown' }), filename };
}

// ---- Progress ----------------------------------------------------------------
// MeTube reports erratically: "postprocessing" before the download, for video
// (YouTube: video and audio streams separate) 0 to 100 % twice, then
// "postprocessing" and "finished" while the job is still running. This turns
// it into a value that only moves forward: starting, loading N %, finishing.
// progs: Map URL|kind -> { part, last, shown }, owned by the caller.
function progress(job, progs) {
  const kind = job.download_type || 'video';
  const key = job.url + '|' + kind;
  const s = progs.get(key) || { part: 1, last: 0, shown: 0 };
  progs.set(key, s);
  const p = Number(job.percent);
  if (job.status === 'downloading' && isFinite(p)) {
    if (p < s.last - 50) s.part += 1;   // next track starts at 0
    s.last = p;
    const parts = kind === 'video' ? 2 : 1;
    s.shown = Math.max(s.shown, Math.min(99, ((Math.min(s.part, parts) - 1) * 100 + p) / parts));
    return { pct: s.shown, verb: 'loading ' + Math.round(s.shown) + ' %' };
  }
  if ((job.status === 'postprocessing' || job.status === 'finished') && (s.shown > 0 || p >= 100)) {
    s.shown = 100;
    return { pct: 100, verb: 'finishing …' };
  }
  return s.shown ? { pct: s.shown, verb: 'loading ' + Math.round(s.shown) + ' %' } : { pct: null, verb: 'starting …' };
}

// ---- Shared DOM helpers (web/app.js and extension/popup.js) ------------------

function flash(btn) {
  btn.classList.remove('flash');
  void btn.offsetWidth;
  btn.classList.add('flash');
  setTimeout(() => btn.classList.remove('flash'), 900);
}

function setVerb(c, verb) {
  const label = LABEL[c.dataset.kind];
  c.querySelector('.verb').textContent = verb;
  c.title = verb === 'waiting' ? label + ': only when the running job is done' : label + ' ' + verb;
  c.setAttribute('aria-label', c.title);
}

function setThumb(el, url, kind, allowThumb, lazy) {
  const thumb = allowThumb ? thumbFor(url) : null;
  const look = thumb || kind;
  if (el.dataset.look === look) return;
  el.dataset.look = look;
  el.classList.toggle('thumb', !!thumb);
  el.innerHTML = thumb
    ? '<img alt=""' + (lazy ? ' loading="lazy"' : '') + ' referrerpolicy="no-referrer">'
    : (ICON[kind] || ICON.video);
  if (thumb) el.firstChild.src = thumb;
}

// Two-tap tiles: first tap selects, second tap sends. Esc, outside click or 4 s cancels.
function initTiles({ tiles, urlInput, statusEl, setStatus, onSend, onSent }) {
  tiles.querySelectorAll('.tile').forEach((t) => {
    t.insertAdjacentHTML('afterbegin', ICON[t.dataset.kind].replace('<svg', '<svg class="ico"') + SPIN + CHECK('check'));
    t.insertAdjacentHTML('beforeend',
      '<span class="ask">tap again</span><span class="busytxt">sending …</span><span class="donetxt">sent</span>');
  });

  let armed = null;
  let armTimer = null;
  let sending = false;
  const tile = (kind) => tiles.querySelector('[data-kind="' + kind + '"]');

  function disarm() {
    clearTimeout(armTimer);
    if (armed && statusEl.textContent.endsWith('again to start.')) setStatus('');
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

  function burst(t) {
    for (let i = 0; i < 12; i++) {
      const s = document.createElement('span');
      const size = 3 + Math.random() * 3;
      s.className = 'burst';
      s.style.width = s.style.height = size + 'px';
      s.style.setProperty('--a', (i * 30 + (Math.random() * 20 - 10)) + 'deg');
      s.style.setProperty('--d', -(24 + Math.random() * 15) + 'px');
      t.appendChild(s);
    }
    setTimeout(() => t.querySelectorAll('.burst').forEach((s) => s.remove()), 700);
  }

  function shakeUrl(msg) {
    urlInput.classList.remove('shake');
    void urlInput.offsetWidth;
    urlInput.classList.add('shake');
    urlInput.focus();
    setStatus(msg, true);
  }

  tiles.addEventListener('click', async (e) => {
    const t = e.target.closest('.tile');
    if (!t || sending) return;
    const url = urlInput.value.trim();
    if (!url) { shakeUrl('Paste a link first.'); return; }
    if (!isWebUrl(url)) { shakeUrl('That does not look like a link.'); return; }
    const kind = t.dataset.kind;
    if (armed !== kind) {
      arm(kind);
      setStatus('Tap "' + LABEL[kind] + '" again to start.');
      return;
    }
    disarm();
    sending = true;
    tiles.classList.add('sending');
    t.classList.add('busy');
    setStatus(kind === 'captions' ? 'Detecting language …' : 'Sending …');
    try {
      const res = await onSend(canonical(url), kind);
      t.classList.remove('busy');
      t.classList.add('done');
      burst(t);
      setStatus(res.status);
      urlInput.value = '';
      if (onSent) onSent(res);
      setTimeout(() => { t.classList.remove('done'); tiles.classList.remove('sending'); sending = false; }, 1300);
    } catch (err) {
      t.classList.remove('busy');
      t.classList.add('fail');
      setStatus(err.message || 'That did not work.', true);
      setTimeout(() => { t.classList.remove('fail'); tiles.classList.remove('sending'); sending = false; }, 600);
    }
  });

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && armed) { e.preventDefault(); disarm(); } });
  document.addEventListener('click', (e) => { if (armed && !e.target.closest('.tile')) disarm(); });

  return { disarm, click: () => tile(armed || 'video').click() };
}

function makeFormatCells(container) {
  const cells = {};
  for (const f of FORMATS) {
    const c = document.createElement('button');
    c.type = 'button';
    c.className = 'fmt';
    c.dataset.kind = f.kind;
    c.innerHTML = ICON[f.kind] + SPIN + CHECK('tick') +
      '<span class="lbl">' + f.label + '</span><span class="verb"></span>';
    container.appendChild(c);
    cells[f.kind] = c;
  }
  return cells;
}

function updateFormatCells(cells, { busy, files, failed, itemKind, panelHidden, progs, onDone }) {
  for (const f of FORMATS) {
    const c = cells[f.kind];
    // After a tap the cell stays on "loading" until MeTube has accepted the
    // job and it appears in the list.
    const pending = c.dataset.inflight === '1' || c.dataset.sent > Date.now() - 4000;
    if (c.dataset.state === 'busy' && !busy.has(f.kind) && !files[f.kind] && pending) continue;
    // MeTube accepts only one job per URL at a time.
    const state = busy.has(f.kind) ? 'busy' : files[f.kind] ? 'have' : busy.size ? 'blocked' :
      failed && itemKind === f.kind ? 'fail' : 'missing';
    const was = c.dataset.state;
    if (was !== state) {
      c.dataset.state = state;
      if (state === 'busy') c.dataset.sent = Date.now();
    }
    let verb = state === 'have' && f.kind === 'captions' ? (panelHidden ? 'show' : 'hide') : VERBS[state];
    const job = busy.get(f.kind);
    const run = job ? progress(job, progs) : null;
    c.classList.toggle('wait', !!run && run.pct === null);
    c.style.setProperty('--p', (run && run.pct !== null ? Math.max(4, run.pct) : 0) + '%');
    if (run) verb = run.verb;
    if (!c.classList.contains('cancel') && c.querySelector('.verb').textContent !== verb) setVerb(c, verb);
    if (was === 'busy' && state === 'have') {
      c.classList.remove('wait');
      c.classList.add('finishing');
      setTimeout(() => { c.classList.remove('finishing'); flash(c); }, 450);
      if (onDone) onDone();
    }
  }
}

function toggleTextPanel(panel, cell, open, loadText) {
  panel.hidden = !open;
  cell.classList.toggle('open', open);
  cell.setAttribute('aria-expanded', String(open));
  if (cell.dataset.state === 'have') setVerb(cell, open ? 'hide' : 'show');
  if (!open) return;
  const preview = panel.querySelector('.preview');
  const head = panel.querySelector('.tp-head');
  head.textContent = 'Preview';
  preview.textContent = 'Loading text …';
  preview.classList.add('loading');
  loadText().then((t) => {
    preview.textContent = t || 'The text is empty.';
    head.textContent = 'Preview · ' + (t ? t.split(' ').length : 0).toLocaleString() + ' words';
  }, (e) => { preview.textContent = 'Could not load text: ' + e.message; })
    .finally(() => preview.classList.remove('loading'));
}

// A tap does what the cell says: save, show text, request, retry. Requesting
// does not ask first; a running format is cancelled by tapping its cell twice.
async function handleFormatClick(c, { item, files, onToggleText, onSave, onCancel, onRetry, onRequest, notify, onAfter }) {
  const kind = c.dataset.kind;
  const state = c.dataset.state;
  if (state === 'blocked' || c.dataset.inflight === '1') return;
  if (state === 'busy') {
    if (!c.classList.contains('cancel')) {
      c.classList.add('cancel');
      setVerb(c, 'tap to cancel');
      setTimeout(() => c.classList.remove('cancel'), 4000);
      return;
    }
    c.classList.remove('cancel');
    try {
      await onCancel(item.url);
      notify('Cancelled.');
    } catch (e) {
      notify('Cancel did not work: ' + e.message, true);
    }
    onAfter();
    return;
  }
  if (state === 'have') {
    if (kind === 'captions') { onToggleText(); return; }
    try {
      await onSave(files[kind], kind);
      flash(c);
    } catch (e) {
      notify('Download failed: ' + e.message, true);
    }
    return;
  }
  c.dataset.state = 'busy';
  c.dataset.inflight = '1';
  c.classList.add('wait');
  setVerb(c, 'starting …');
  try {
    if (state === 'fail' && item.status === 'error') {
      await onRetry(item.url);
    } else {
      await onRequest(item.url, kind);
    }
    c.dataset.sent = Date.now();
    notify(LABEL[kind] + ' is loading.');
    setTimeout(onAfter, 600);
  } catch (e) {
    c.classList.remove('wait');
    c.dataset.state = state;
    setVerb(c, VERBS[state]);
    notify(e.message || 'That did not work.', true);
  } finally {
    delete c.dataset.inflight;
  }
}
