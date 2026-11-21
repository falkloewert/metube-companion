'use strict';

// Shared by the web UI (web/app.js) and the browser extension
// (extension/popup.js, background.js): jobs, formats, language detection,
// progress, icons. Pure functions and constants only, no DOM, no fetch.
// The extension gets this file at build time (extension/build.sh).

const ICON = {
  video: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10 9.5v5l4.5-2.5z"/></svg>',
  audio: '<svg viewBox="0 0 24 24"><path d="M9 18V6l11-2v12"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>',
  captions: '<svg viewBox="0 0 24 24"><path d="M4 6h16M4 10h16M4 14h11M4 18h7"/></svg>',
  md: '<svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M12 11v6m-2.5-2.5L12 17l2.5-2.5"/></svg>',
  copy: '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/></svg>',
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

const FORMATS = [
  { kind: 'video', label: 'Video', ext: /^(mp4|webm|mkv|mov)$/i },
  { kind: 'audio', label: 'Audio', ext: /^(m4a|mp3|opus|ogg|wav|flac)$/i },
  { kind: 'captions', label: 'Text', ext: /^[\w-]+\.txt$/i },
  { kind: 'thumbnail', label: 'Thumbnail', ext: /^(jpe?g|webp|png)$/i },
];

const VERBS = { have: 'save', missing: 'request', busy: 'loading …', fail: 'retry', blocked: 'waiting' };


function ytId(url) {
  try {
    const u = new URL(url);
    if (/(^|\.)youtu\.be$/.test(u.hostname)) return u.pathname.slice(1) || null;
    if (/(^|\.)youtube\.com$/.test(u.hostname)) {
      return u.searchParams.get('v') || (u.pathname.match(/^\/(?:shorts|live|embed)\/([^/]+)/) || [])[1] || null;
    }
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
  return id && /^[\w-]{11}$/.test(id) ? 'https://i.ytimg.com/vi/' + id + '/mqdefault.jpg' : null;
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
  return !de && tracks.some((t) => !t.asr && t.lang.startsWith('en')) ? 'en' : 'de';}

function friendlyError(msg) {
  const m = String(msg || '');
  if (/429|Too Many Requests/i.test(m)) return 'YouTube is blocking requests right now (too many). Try again later.';
  if (/cookies are no longer valid/i.test(m)) return 'The stored YouTube cookies have expired. Send once via the extension (it sends fresh ones) or remove them under "Cookies".';
  if (/Sign in to confirm/i.test(m)) return 'YouTube wants a sign-in. Send cookies via the extension and try again.';
  if (/private|unavailable/i.test(m)) return 'Video is private or unavailable.';
  return m.replace(/^ERROR:\s*/i, '') || 'Error';
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
  if (id && /^[\w-]{11}$/.test(id)) {
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
