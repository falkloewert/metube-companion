'use strict';

// Desktop setup default (DEFAULT_BASE from compat.js); other instances are set
// here. Saving asks the browser for the site cookies if ticked (optional
// permissions), then checks that a MeTube Companion answers there.
const base = document.getElementById('base');
const status = document.getElementById('status');
const token = document.getElementById('token');

function say(text, bad) {
  status.textContent = text;
  status.className = bad ? 'bad' : 'ok';
}

// Download settings (shared.js): saved right away on change.
const prefSelects = Object.keys(PREF_OPTIONS).map((k) => {
  const sel = document.getElementById(k);
  PREF_OPTIONS[k].forEach(([v, t]) => sel.add(new Option(t, v)));
  sel.addEventListener('change', async () => {
    const { prefs } = await browser.storage.local.get('prefs');
    await browser.storage.local.set({ prefs: Object.assign(normalizePrefs(prefs), { [k]: sel.value }) });
    say('Saved.');
  });
  return [k, sel];
});

const cookies = document.getElementById('cookies');

browser.storage.local.get(['base', 'token', 'prefs', 'sendCookies']).then(({ base: saved, token: savedToken, prefs, sendCookies }) => {
  base.value = saved || DEFAULT_BASE;
  token.value = savedToken || '';
  cookies.checked = !!sendCookies;
  const p = normalizePrefs(prefs);
  prefSelects.forEach(([k, sel]) => { sel.value = p[k]; });
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
  if (cookies.checked && !cookieSafe(origin)) {
    say('Cookies are only sent to an https:// address or to this computer. Use HTTPS for your instance or untick the cookies.', true);
    return;
  }
  // The instance needs no permission (it answers the extension via CORS);
  // only the cookies do. Must run directly in the click handler, browsers
  // only allow the prompt there.
  if (cookies.checked) {
    let granted = false;
    try {
      granted = await browser.permissions.request(cookiePermissions());
    } catch (_) { /* treated as not granted */ }
    if (!granted) {
      say('The browser did not allow the cookies. Untick them to save without.', true);
      return;
    }
  } else {
    await browser.permissions.remove(cookiePermissions()).catch(() => {});
  }
  const tok = token.value.trim();
  await browser.storage.local.set({ base: value, token: tok, sendCookies: cookies.checked });
  say('Saved. Checking the connection …');
  let res;
  try {
    res = await fetch(value + '/ext/history', {
      credentials: 'include', headers: tok ? { 'X-Companion-Token': tok } : {}
    });
  } catch (_) {
    say('Saved, but ' + origin + ' is not reachable. Check the address and that you are on the same network or VPN. Not set up yet? See the setup guide above.', true);
    return;
  }
  try {
    if (res.status === 401) throw new Error(tok ? 'the access token is wrong.' : 'this instance is protected, enter its access token.');
    if (res.status === 421) throw new Error('the instance does not answer to this name. Add it to COMPANION_HOSTS (INSTALL.md) or use its IP address.');
    if (res.status === 404) throw new Error('this looks like MeTube without the companion. The extension needs MeTube Companion in front of MeTube.');
    if (!res.ok) throw new Error('the instance answered with HTTP ' + res.status + '.');
    await res.json();
    say('Saved and connected.');
  } catch (e) {
    say('Saved, but ' + (res.ok ? 'the answer is not from MeTube Companion. Check the address.' : e.message), true);
  }
});
