'use strict';

// In Chromium this script runs as a service worker and does not know
// browser.*; in Firefox manifest.json loads compat.js and shared.js first.
if (typeof importScripts === 'function') importScripts('compat.js', 'shared.js');

// Cookies only for the site of the link, and only for these sites. Never all
// cookies of the browser, and never google.com: those are the whole Google
// account (mail, drive), yt-dlp only needs the youtube.com ones.
const COOKIE_SITES = [
  { host: /(^|\.)(youtube\.com|youtu\.be)$/, root: 'https://www.youtube.com/' },
  { host: /(^|\.)instagram\.com$/, root: 'https://www.instagram.com/' },
  { host: /(^|\.)tiktok\.com$/, root: 'https://www.tiktok.com/' },
];

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
  let host = '';
  try { host = new URL(url).hostname; } catch (_) { /* no cookies */ }
  const roots = COOKIE_SITES.filter((s) => s.host.test(host)).map((s) => s.root);

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

// Spoken language (rules in shared.js). The extension fetches the watch
// page itself, with the browser's YouTube cookies. On error: German.
async function detectLang(url) {
  try {
    const id = ytId(url);
    if (!id) return 'de';
    const res = await fetch('https://www.youtube.com/watch?v=' + id, { credentials: 'include' });
    return langFromWatchPage(await res.text());
  } catch (_) {
    return 'de';
  }
}

async function send(url, kind) {
  if (!isWebUrl(url)) throw new Error('That is not a link.');
  const base = await getBase();
  if ((url + '/').startsWith(base + '/')) throw new Error('That is the MeTube page itself, not the video.');

  const cookies = await collectCookies(url);
  if (cookies.length) {
    const form = new FormData();
    form.append('cookies', new Blob([netscape(cookies)], { type: 'text/plain' }), 'cookies.txt');
    await extPost('/ext/upload-cookies', form);
  }

  const { prefs } = await browser.storage.local.get('prefs');
  const body = Object.assign({ url }, buildPayload(kind, prefs));
  if (kind === 'captions') body.subtitle_language = await detectLang(url);
  checkAddResult(await extPost('/ext/add', body));
  return { n: cookies.length, lang: body.subtitle_language };
}

async function flashBadge(bad) {
  try {
    await browser.browserAction.setBadgeText({ text: bad ? '!' : '✓' });
    await browser.browserAction.setBadgeBackgroundColor({ color: bad ? '#b3261e' : '#178a4c' });
  } catch (_) { /* ignore */ }
  setTimeout(() => browser.browserAction.setBadgeText({ text: '' }).catch(() => {}), 6000);
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

browser.runtime.onInstalled.addListener(({ reason }) => {
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
    await flashBadge();
    await notify('MeTube', n ? 'Link sent with cookies.' : 'Link sent (without cookies).');
  } catch (e) {
    await flashBadge(true);
    await notify('MeTube: error', e.message);
  }
});

browser.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (!msg || msg.type !== 'send') return false;
  startSend(msg.url, msg.kind)
    .then((r) => { reply({ ok: true, withCookies: r.n > 0, lang: r.lang, url: r.url }); })
    .catch((e) => reply({ ok: false, message: e.message }));
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
  if (!pending.some((j) => j.url === url)) pending.push({ url });
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
    title: done ? 'MeTube: done' : 'MeTube: error',
    message: done ? title + ' is downloaded.' : title + ': ' + failReason(item)
  };
  // Only Chromium and Firefox know buttons; set as an option, not an empty array.
  if (done) opts.buttons = [{ title: 'Download to this computer', iconUrl: browser.runtime.getURL('icon-48.png') }];
  try {
    await browser.notifications.create(id, opts);
  } catch (_) { /* the notification is an extra */ }
}

// True when a failed job was sent again (YouTube 403, see shouldAutoRetry);
// then it stays pending instead of reporting the error.
async function autoRetry(item) {
  const { retried = {} } = await browser.storage.local.get('retried');
  const now = Date.now();
  if (!shouldAutoRetry(item, retried, now)) return false;
  for (const u of Object.keys(retried)) if (now - retried[u] >= AUTO_RETRY_MS) delete retried[u];
  retried[item.url] = now;
  await browser.storage.local.set({ retried });
  try { await retryJob(item.url, (p, b) => extPost('/ext' + p, b)); return true; } catch (_) { return false; }
}

async function dropPending(url) {
  const { pending = [] } = await browser.storage.local.get('pending');
  await browser.storage.local.set({ pending: pending.filter((j) => j.url !== url) });
}

// Check right after sending while the worker is still alive: short
// downloads report within seconds. Long ones are taken over by the alarm (30 s).
async function watchFast(url) {
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 4000));
    await browser.runtime.getPlatformInfo(); // keeps the worker alive
    let item;
    try { item = (await historyItems()).find((x) => x.url === url); } catch (_) { continue; }
    if (!item) continue;
    if (item.status === 'error' && await autoRetry(item)) continue;
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
  let all;
  try { all = await historyItems(); } catch (_) { return; }

  if (outbox) {
    // Only redo if the first attempt really created nothing.
    if (!all.some((i) => i.url === outbox.url)) {
      try { await send(outbox.url, outbox.kind); } catch (_) { /* the result shows up in the history */ }
    }
    await browser.storage.local.remove('outbox');
    await trackJob(outbox.url);
    return checkJobs();
  }

  const rest = [];
  for (const job of pending) {
    const item = all.find((i) => i.url === job.url);
    if (!item) continue;
    if (item.status === 'error' && await autoRetry(item)) {
      rest.push(job);
    } else if (item.status === 'finished' || item.status === 'error') {
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
  const url = (await getBase()) + '/ext/download/' + encPath(relPath(info.filename));
  try { await browser.downloads.download({ url, saveAs: false, headers: await downloadHeaders() }); } catch (_) { /* see popup */ }
  await browser.notifications.clear(id);
});

browser.notifications.onClicked.addListener(async (id) => {
  const key = 'n:' + id;
  const { [key]: info } = await browser.storage.local.get(key);
  await browser.storage.local.remove(key);
  if (info && isWebUrl(info.url)) {
    try { await browser.tabs.create({ url: info.url }); } catch (_) { /* see popup */ }
  }
  browser.notifications.clear(id).catch(() => {});
});

browser.runtime.onStartup.addListener(() => { checkJobs().catch(() => {}); });
