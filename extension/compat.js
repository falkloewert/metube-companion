'use strict';

// Firefox provides browser.* with promises, Chromium only chrome.*. Here
// chrome is wrapped into a promise-based browser. Nothing happens in Firefox.
// browserAction does not exist in Manifest V3, it is called action there.
if (typeof globalThis.browser === 'undefined' && typeof globalThis.chrome !== 'undefined') {
  globalThis.browser = new Proxy({}, {
    get(_target, prop) {
      const name = prop === 'browserAction' ? 'action' : prop;
      const value = globalThis.chrome[name];
      return typeof value === 'function' ? value.bind(globalThis.chrome) : value;
    }
  });
}

// Desktop setup default; other instances are set on the options page, which
// also asks for the host permission (optional_host_permissions).
const DEFAULT_BASE = 'http://localhost:8081';

async function getBase() {
  const { base } = await browser.storage.local.get('base');
  return (base || DEFAULT_BASE).replace(/\/+$/, '');
}

// Sending cookies is optional ("sendCookies" in storage): the settings page
// asks for it (one browser prompt together with the instance address), never
// the install.
const COOKIE_ORIGINS = ['https://*.youtube.com/*', 'https://*.instagram.com/*', 'https://*.tiktok.com/*'];
function cookiePermissions() {
  const p = { permissions: ['cookies'], origins: COOKIE_ORIGINS.slice() };
  // Firefox also has a data collection consent for it (manifest.json).
  if (browser.runtime.getManifest().browser_specific_settings) p.data_collection = ['authenticationInfo'];
  return p;
}

// Cookies are sign-in data: only over HTTPS or to this computer.
function cookieSafe(base) {
  try {
    const u = new URL(base);
    return u.protocol === 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  } catch (_) {
    return false;
  }
}

// Optional access token of a protected instance (COMPANION_TOKEN), sent as a
// header with every request to the instance.
async function authHeaders() {
  const { token } = await browser.storage.local.get('token');
  return token ? { 'X-Companion-Token': token } : {};
}

function cannotReach(base) {
  return 'Cannot reach ' + base + '. Check the address in Settings and your network or VPN.';
}

// The browser's own network error ("Failed to fetch") says nothing to users.
async function ifetch(url, init = {}) {
  const headers = Object.assign({}, init.headers, await authHeaders());
  try {
    return await fetch(url, Object.assign({ credentials: 'include' }, init, { headers }));
  } catch (_) {
    throw new Error(cannotReach(await getBase()));
  }
}

async function downloadHeaders() {
  return Object.entries(await authHeaders()).map(([name, value]) => ({ name, value }));
}

// POST to /ext/... as text/plain (JSON) or FormData: application/json would
// trigger a CORS preflight, which an authenticating proxy rejects without a session.
async function extPost(path, body) {
  const init = body instanceof FormData
    ? { method: 'POST', body }
    : { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify(body) };
  const res = await ifetch((await getBase()) + path, init);
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { /* HTML instead of JSON */ }
  if (!res.ok) throw new Error((data && (data.msg || data.error)) || ('HTTP ' + res.status));
  if (data === null) throw new Error('The response was not JSON. Open the MeTube page once and sign in.');
  return data;
}
