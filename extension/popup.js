'use strict';

// Extension popup, same interaction as the web UI (web/app.js): tap a tile
// once to select, tap again to send. Below it the last sent video with the
// same format bar (Video, Audio, Text, Image). Shared helpers live in shared.js
// and compat.js.

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

$('copy').insertAdjacentHTML('afterbegin', ICON.copy + CHECK('tick'));
$('md').insertAdjacentHTML('afterbegin', ICON.md + CHECK('tick'));
$('home').insertAdjacentHTML('afterbegin', ICON.open);

function setStatus(text, bad) {
  status.textContent = text;
  status.classList.toggle('err', !!bad);
}

browser.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
  // Never suggest the MeTube page itself (e.g. the extension download).
  const own = (await getBase()) + '/';
  if (tab && isWebUrl(tab.url) && !tab.url.startsWith(own)) urlInput.value = tab.url;
  // With a prefilled link the tiles take focus; if empty, paste right away.
  if (!urlInput.value) urlInput.focus();
}).catch(() => {});
// Focusing the field selects everything, so pasting replaces the old link.
urlInput.addEventListener('focus', () => urlInput.select());

initTiles({
  tiles,
  urlInput,
  statusEl: status,
  setStatus,
  onSend: async (url, kind) => {
    const res = await browser.runtime.sendMessage({ type: 'send', url, kind });
    if (!res || !res.ok) throw new Error((res && res.message) || 'That did not work.');
    const lang = res.lang ? ', text in ' + (res.lang === 'en' ? 'English' : 'German') : '';
    return { url: res.url || url, status: (res.withCookies ? 'Sent, with cookies' : 'Sent, without cookies') + lang + '.' };
  },
  onSent: (res) => watch(res.url),
});

// ---- Last video with format bar ----------------------------------------------

const cells = makeFormatCells(formats);
let lastUrl = null;
let jobTimer = null;
let refreshing = false;
let item = null;              // history entry of the video (last job)
let files = {};               // kind -> relative path of the existing file
let text = null;              // { rel, promise } for preview, copy, .md
const progs = new Map();

// Why the instance does not answer: protected (token missing or wrong) or
// not reachable at all; empty if it answers. Uses /ext/, which a login proxy
// lets through (INSTALL.md).
async function unreachable() {
  const base = await getBase();
  try {
    const r = await ifetch(base + '/ext/history');
    if (r.ok) return '';
    if (r.status === 401) return 'This instance is protected. Enter its access token in Settings.';
  } catch (_) { /* not reachable */ }
  return cannotReach(base);
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
        const r = await ifetch(base + '/files/' + (dir ? encPath(dir) + '/' : ''));
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
    if (!status.textContent) setStatus((await unreachable()) || 'That did not work.', true);
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
  const failed = !running.size && isFailed(done);
  const first = running.values().next().value;
  const run = first ? progress(first, progs) : null;

  setThumb(jobKind, lastUrl, kind, !(failed && !Object.keys(files).length), false);
  jobTitle.textContent = item.title || lastUrl;
  jobTitle.dataset.url = item.url || '';
  job.classList.toggle('error', failed);
  const report = $('report');
  report.hidden = !failed;
  if (failed) report.href = reportUrl(done, 'extension');
  jobMeta.textContent = run ? LABEL[first.download_type || 'video'] + ': ' + run.verb
    : failed ? failReason(done) : 'stored on the server';

  updateFormatCells(cells, {
    busy: running,
    files,
    failed,
    itemKind: kind,
    panelHidden: panel.hidden,
    progs,
  });
  if (!files.captions && !panel.hidden) toggleTextPanel(panel, cells.captions, false);
}

function watch(url) {
  if (url !== lastUrl) { toggleTextPanel(panel, cells.captions, false); text = null; progs.clear(); }
  lastUrl = url;
  browser.storage.local.set({ last: { url } });
  if (!jobTimer) jobTimer = setInterval(refreshJob, 2000);
  refreshJob();
}

// ---- Format cells: save, show text, request, retry ---------------------------

const fileUrl = async (rel) => (await getBase()) + '/ext/download/' + encPath(rel);

function textOf() {
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

formats.addEventListener('click', (e) => {
  const c = e.target.closest('.fmt');
  if (!c || !item) return;
  handleFormatClick(c, {
    item,
    files,
    onToggleText: () => toggleTextPanel(panel, cells.captions, panel.hidden, textOf),
    onSave: async (rel, kind) => {
      await browser.downloads.download({ url: await fileUrl(rel), saveAs: false, headers: await downloadHeaders() });
      setStatus(LABEL[kind] + ': download started.');
    },
    onCancel: async (url) => {
      const r = await extPost('/ext/delete', { ids: [url], where: 'queue' });
      if (r && r.status === 'error') throw new Error(r.msg || 'MeTube refused.');
    },
    onRetry: (url) => retryJob(url, (p, b) => extPost('/ext' + p, b)),
    onRequest: async (url, kind) => {
      const res = await browser.runtime.sendMessage({ type: 'send', url, kind });
      if (!res || !res.ok) throw new Error((res && res.message) || 'That did not work.');
    },
    notify: setStatus,
    onAfter: refreshJob,
  });
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
    const { blob, filename } = transcriptMd(jobTitle.textContent, jobTitle.dataset.url, await textOf());
    const url = URL.createObjectURL(blob);
    await browser.downloads.download({ url, filename, saveAs: false });
    setTimeout(() => URL.revokeObjectURL(url), 5000);
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
unreachable().then((msg) => { if (msg) setStatus(msg, true); });

// After opening, keep showing the last video (also if the context menu
// started it).
browser.storage.local.get('last').then(({ last }) => {
  if (last && last.url) watch(last.url);
}).catch(() => {});
