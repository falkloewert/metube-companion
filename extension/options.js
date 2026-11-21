'use strict';

// Desktop setup default (DEFAULT_BASE from compat.js); other instances are set
// here. Saving asks the browser for access to that address (optional host
// permission) and checks that a MeTube Companion answers there.
const base = document.getElementById('base');
const status = document.getElementById('status');
const token = document.getElementById('token');

function say(text, bad) {
  status.textContent = text;
  status.className = bad ? 'bad' : 'ok';
}

browser.storage.local.get(['base', 'token']).then(({ base: saved, token: savedToken }) => {
  base.value = saved || DEFAULT_BASE;
  token.value = savedToken || '';
});

document.getElementById('save').addEventListener('click', async () => {
  const value = base.value.trim().replace(/\/+$/, '');
  let origin;
  try {
    const u = new URL(value);
    if (!/^https?:$/.test(u.protocol)) throw new Error();
    origin = u.origin;
  } catch (_) {
    say('Please enter a full address starting with http:// or https://.', true);
    return;
  }
  // Must run directly in the click handler, browsers only allow it there.
  let granted = false;
  try {
    granted = await browser.permissions.request({ origins: [origin + '/*'] });
  } catch (_) { /* treated as not granted */ }
  if (!granted) {
    say('The browser did not allow access to ' + origin + '. Without it the extension cannot reach your instance.', true);
    return;
  }
  const tok = token.value.trim();
  await browser.storage.local.set({ base: value, token: tok });
  say('Saved. Checking the connection …');
  try {
    const res = await fetch(value + '/ext/history', {
      credentials: 'include', headers: tok ? { 'X-Companion-Token': tok } : {}
    });
    if (res.status === 401) throw new Error(tok ? 'The access token is wrong.' : 'This instance is protected, enter its access token.');
    if (res.status === 404) throw new Error('This looks like MeTube without the companion. The extension needs MeTube Companion in front of MeTube.');
    if (!res.ok) throw new Error('The instance answered with HTTP ' + res.status + '.');
    await res.json();
    say('Saved and connected.');
  } catch (e) {
    say('Saved, but the instance is not reachable: ' + (e.message || 'network error') + ' Check the address and that you are on the same network or VPN.', true);
  }
});
