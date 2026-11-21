'use strict';

// ponytail: fixed placeholder, issue #4 makes the instance URL configurable at runtime
const DEFAULT_BASE = 'http://localhost:8081';
const base = document.getElementById('base');
const status = document.getElementById('status');

browser.storage.local.get('base').then(({ base: saved }) => {
  base.value = saved || DEFAULT_BASE;
});

document.getElementById('save').addEventListener('click', async () => {
  const value = base.value.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(value)) {
    status.textContent = 'Please enter a full address starting with http:// or https://.';
    return;
  }
  await browser.storage.local.set({ base: value });
  status.textContent = 'Saved.';
});
