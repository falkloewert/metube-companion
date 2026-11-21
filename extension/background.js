'use strict';

// In Chromium this script runs as a service worker and does not know
// browser.*; in Firefox browser exists already and importScripts does not
// (there manifest.json loads shared.js first). shared.js is the part shared
// with the web UI (PAYLOADS, ytId, canonical, language detection).
if (typeof importScripts === 'function') importScripts('compat.js', 'shared.js');

// Desktop setup default; other instances are set on the options page, which
// also asks for the host permission (optional_host_permissions).
const DEFAULT_BASE = 'http://localhost:8081';

// Cookies for these sites only. Never all cookies of the browser: they
// include banking and mail sessions that MeTube has no business with.
const ROOTS = [
  'https://www.youtube.com/',
  'https://www.google.com/',
  'https://www.instagram.com/',
  'https://www.tiktok.com/'
];

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

function netscape(cookies) {
  const lines = ['# Netscape HTTP Cookie File'];
  for (const c of cookies) {
    lines.push([
      c.domain,
      c.domain.startsWith('.') ? 'TRUE' : 'FALSE',
      c.path || '/',
      c.secure ? 'TRUE' : 'FALSE',
      c.expirationDate ? Math.floor(c.expirationDate) : 0,
      c.name,
      c.value
    ].join('\t'));
  }
  return lines.join('\n') + '\n';
}

async function collectCookies(url) {
  const roots = ROOTS.slice();
  try {
    const u = new URL(url);
    const same = u.origin + '/';
    if (!roots.includes(same)) roots.push(same);
  } catch (_) { /* invalid URL, then only the fixed sites */ }

  const seen = new Set();
  const cookies = [];
  for (const root of roots) {
    let list = [];
    try {
      list = await browser.cookies.getAll({ url: root });
    } catch (_) {
      continue; // no permission for this site, that is fine
    }
    for (const c of list) {
      const key = [c.domain, c.path, c.name].join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      cookies.push(c);
    }
  }
  return cookies;
}

async function post(base, path, options) {
  const res = await ifetch(base + path, options);
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { /* HTML instead of JSON */ }
  if (!res.ok) {
    throw new Error((data && (data.msg || data.error)) || ('HTTP ' + res.status));
  }
  if (data === null) {
    throw new Error('The response was not JSON. Open the MeTube page once and sign in.');
  }
  return data;
}

// Spoken language (rules in shared.js). The extension fetches the watch
// page itself, with the browser's YouTube cookies. On error: German.
async function detectLang(url) {
  try {
    const id = ytId(url);
    if (!id) return 'de';
    const res = await fetch('https://www.youtube.com/watch?v=' + encodeURIComponent(id), { credentials: 'include' });
    return langFromWatchPage(await res.text());
  } catch (_) {
    return 'de';
  }
}

async function send(url, kind) {
  if (!/^https?:\/\//i.test(url || '')) throw new Error('That is not a link.');
  const base = await getBase();
  if ((url + '/').startsWith(base + '/')) throw new Error('That is the MeTube page itself, not the video.');

  const cookies = await collectCookies(url);
  if (cookies.length) {
    const form = new FormData();
    form.append('cookies', new Blob([netscape(cookies)], { type: 'text/plain' }), 'cookies.txt');
    await post(base, '/ext/upload-cookies', { method: 'POST', body: form });
  }

  const body = Object.assign({ url }, PAYLOADS[kind] || PAYLOADS.video);
  if (kind === 'captions') body.subtitle_language = await detectLang(url);
  const data = await post(base, '/ext/add', {
    method: 'POST',
    // text/plain instead of application/json: otherwise the browser sends a
    // CORS preflight, which an authenticating proxy rejects without a session.
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    body: JSON.stringify(body)
  });
  if (data && data.status === 'error') throw new Error(data.msg || 'MeTube rejected the request.');
  if (data && /already/i.test(data.msg || '')) throw new Error('Already running.');
  return { n: cookies.length, lang: body.subtitle_language };
}

async function flash(text, bad) {
  try {
    await browser.browserAction.setBadgeText({ text: bad ? '!' : '✓' });
    await browser.browserAction.setBadgeBackgroundColor({ color: bad ? '#b3261e' : '#178a4c' });
  } catch (_) { /* ignore */ }
  setTimeout(() => browser.browserAction.setBadgeText({ text: '' }).catch(() => {}), 6000);
  return text;
}

async function notify(title, message) {
  try {
    await browser.notifications.create({
      type: 'basic',
      // Chromium accepts only PNG for notifications; SVG is rejected.
      iconUrl: browser.runtime.getURL('icon-48.png'),
      title,
      message
    });
  } catch (_) { /* the notification is an extra, the badge is enough */ }
}

browser.runtime.onInstalled.addListener(async ({ reason }) => {
  // First install: open the settings so the user picks the instance.
  if (reason === 'install') browser.runtime.openOptionsPage();
  browser.contextMenus.create({
    id: 'metube-link',
    title: 'Send to MeTube',
    contexts: ['link', 'page']
  });
});

browser.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== 'metube-link') return;
  const url = info.linkUrl || info.pageUrl;
  try {
    const { n } = await startSend(url, 'video');
    await flash('Sent');
    await notify('MeTube', n ? 'Link sent with cookies.' : 'Link sent (without cookies).');
  } catch (e) {
    await flash(e.message, true);
    await notify('MeTube: error', e.message);
  }
});

browser.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || msg.type !== 'send') return false;
  startSend(msg.url, msg.kind)
    .then((r) => { reply({ ok: true, withCookies: r.n > 0, lang: r.lang, url: r.url }); })
    .catch(e => reply({ ok: false, message: e.message }));
  return true;
});

// If the popup closes mid-send, Chromium may stop the service worker. So the
// job goes into an outbox before the first network call and is picked up
// again on the next alarm.
async function startSend(url, kind) {
  url = canonical(url);
  await browser.storage.local.set({ outbox: { url, kind } });
  await ensureAlarm();
  try {
    const r = await send(url, kind);
    await trackJob(url);
    await browser.storage.local.set({ last: { url } });
    watchFast(url).catch(() => {});
    return Object.assign({ url }, r);
  } finally {
    await browser.storage.local.remove('outbox');
  }
}

// ---- Done notification, independent of the open popup --------------------
// A timer in the service worker dies with it; alarms wake it up again.
const JOB_ALARM = 'metube-jobs';

async function trackJob(url) {
  const { pending = [] } = await browser.storage.local.get('pending');
  if (!pending.some(j => j.url === url)) pending.push({ url });
  await browser.storage.local.set({ pending: pending.slice(-10) });
  await ensureAlarm();
}

// Chromium allows 30 s, Firefox rounds anything below a minute up to one.
async function ensureAlarm() {
  try {
    await browser.alarms.create(JOB_ALARM, { periodInMinutes: 0.5 });
  } catch (_) {
    await browser.alarms.create(JOB_ALARM, { periodInMinutes: 1 });
  }
}

async function historyItems() {
  const res = await ifetch((await getBase()) + '/ext/history');
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const h = await res.json();
  return [].concat(h.queue || [], h.pending || [], h.done || []);
}

function notifId(url) {
  let h = 0;
  for (let i = 0; i < url.length; i++) h = (h * 31 + url.charCodeAt(i)) | 0;
  return 'metube-' + (h >>> 0).toString(16);
}

async function notifyItem(item) {
  const title = item.title || item.url;
  const done = item.status === 'finished' && item.filename;
  const id = notifId(item.url || title);
  // The mapping holds target URL and file: clicking the body opens the
  // original, the button downloads the file.
  await browser.storage.local.set({
    ['n:' + id]: { url: item.url || '', filename: done ? item.filename : '' }
  });
  const opts = {
    type: 'basic',
    iconUrl: browser.runtime.getURL('icon-48.png'),
    title: item.status === 'finished' ? 'MeTube: done' : 'MeTube: error',
    message: item.status === 'finished'
      ? title + ' is downloaded.'
      : title + ': ' + friendlyError(item.msg || item.error || 'Download failed')
  };
  // Only Chromium and Firefox know buttons; set as an option, not an empty array.
  if (done) opts.buttons = [{ title: 'Download to this computer', iconUrl: browser.runtime.getURL('icon-48.png') }];
  try {
    await browser.notifications.create(id, opts);
  } catch (_) { /* the notification is an extra */ }
}

async function dropPending(url) {
  const { pending = [] } = await browser.storage.local.get('pending');
  await browser.storage.local.set({ pending: pending.filter(j => j.url !== url) });
}

// Check right after sending while the worker is still alive: short
// downloads report within seconds. Long ones are taken over by the alarm (30 s).
async function watchFast(url) {
  for (let i = 0; i < 8; i++) {
    await new Promise(r => setTimeout(r, 4000));
    await browser.runtime.getPlatformInfo(); // keeps the worker alive
    let item;
    try { item = (await historyItems()).find(x => x.url === url); } catch (_) { continue; }
    if (!item) continue;
    if (item.status === 'finished' || item.status === 'error') {
      await dropPending(url);
      await notifyItem(item);
      return;
    }
  }
}

async function checkJobs() {
  const { pending = [], outbox } = await browser.storage.local.get(['pending', 'outbox']);
  if (!pending.length && !outbox) { await browser.alarms.clear(JOB_ALARM); return; }
  let h = null;
  try {
    const res = await ifetch((await getBase()) + '/ext/history');
    if (res.ok) h = await res.json();
  } catch (_) { /* MeTube unreachable right now, next alarm */ }
  if (!h) return;
  const all = [].concat(h.queue || [], h.pending || [], h.done || []);

  if (outbox) {
    // Only redo if the first attempt really created nothing.
    if (!all.some(i => i.url === outbox.url)) {
      try { await send(outbox.url, outbox.kind); } catch (_) { /* the result shows up in the history */ }
    }
    await browser.storage.local.remove('outbox');
    await trackJob(outbox.url);
    return checkJobs();
  }

  const rest = [];
  for (const job of pending) {
    const item = all.find(i => i.url === job.url);
    if (!item) continue;
    if (item.status === 'finished' || item.status === 'error') {
      await notifyItem(item);
    } else {
      rest.push(job);
    }
  }
  await browser.storage.local.set({ pending: rest });
  if (!rest.length) await browser.alarms.clear(JOB_ALARM);
}

browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === JOB_ALARM) checkJobs();
});

// Button in the done notification: straight to the downloads folder, no dialog.
browser.notifications.onButtonClicked.addListener(async (id, index) => {
  if (index !== 0) return;
  const key = 'n:' + id;
  const { [key]: info } = await browser.storage.local.get(key);
  await browser.storage.local.remove(key);
  if (!info || !info.filename) return;
  const rel = String(info.filename).replace(/^\/downloads\//, '').replace(/^\/+/, '');
  const url = (await getBase()) + '/ext/download/' + rel.split('/').map(encodeURIComponent).join('/');
  try { await browser.downloads.download({ url, saveAs: false, headers: await downloadHeaders() }); } catch (_) { /* see popup */ }
  await browser.notifications.clear(id);
});

browser.notifications.onClicked.addListener(async (id) => {
  const key = 'n:' + id;
  const { [key]: info } = await browser.storage.local.get(key);
  await browser.storage.local.remove(key);
  if (info && info.url) {
    try { await browser.tabs.create({ url: info.url }); } catch (_) { /* see popup */ }
  }
  browser.notifications.clear(id).catch(() => {});
});

browser.runtime.onStartup.addListener(() => { checkJobs().catch(() => {}); });

