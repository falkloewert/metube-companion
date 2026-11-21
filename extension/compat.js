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
