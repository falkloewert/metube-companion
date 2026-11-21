'use strict';

// Desktop setup default; other instances are set here. Saving asks the browser
// for access to that address (optional host permission) and checks that a
// MeTube Companion answers there.
const DEFAULT_BASE = 'http://localhost:8081';
const base = document.getElementById('base');
const status = document.getElementById('status');

function say(text, bad) {
  status.textContent = text;
  status.className = bad ? 'bad' : 'ok';
}

browser.storage.local.get('base').then(({ base: saved }) => {
  base.value = saved || DEFAULT_BASE;
});

document.getElementById('save').addEventListener('click', async () => {
  const value = base.value.trim().replace(/\/+$/, '');
  let origin;
  try {
    origin = new URL(value).origin;
    if (!/^https?:$/.test(new URL(value).protocol)) throw new Error();
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
  await browser.storage.local.set({ base: value });
  say('Saved. Checking the connection …');
  try {
    const res = await fetch(value + '/ext/history', { credentials: 'include' });
    if (res.status === 404) throw new Error('This looks like MeTube without the companion. The extension needs MeTube Companion in front of MeTube.');
    if (!res.ok) throw new Error('The instance answered with HTTP ' + res.status + '.');
    await res.json();
    say('Saved and connected.');
  } catch (e) {
    say('Saved, but the instance is not reachable: ' + (e.message || 'network error') + ' Check the address and that you are on the same network or VPN.', true);
  }
});
