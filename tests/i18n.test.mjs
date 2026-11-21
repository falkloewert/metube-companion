// Run: node --test (or node --test tests/i18n.test.mjs)
// shared.js and web/i18n/*.js are browser scripts (no modules): they run in a
// node:vm context with a fake window/navigator.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');

// Context like a browser page: window === global object. languages: what
// navigator.languages returns (null = only navigator.language).
function page({ languages, language, dict = true }) {
  const ctx = { navigator: { languages, language }, document: { documentElement: { lang: 'en' } } };
  ctx.window = ctx;
  vm.createContext(ctx);
  if (dict) vm.runInContext(read('i18n', 'de.js'), ctx, { filename: 'de.js' });
  vm.runInContext(read('shared.js'), ctx, { filename: 'shared.js' });
  return ctx;
}
const run = (ctx, code) => vm.runInContext(code, ctx);

test('t() falls back to English and fills placeholders', () => {
  const en = page({ languages: ['en-US'] });
  assert.equal(run(en, "t('Sent.')"), 'Sent.');
  assert.equal(run(en, "t('Download failed: {msg}', { msg: 'boom' })"), 'Download failed: boom');
  assert.equal(run(en, "t('{n} days left', {})"), '{n} days left');   // unknown variable stays visible
  const none = page({ languages: ['de'], dict: false });              // no dictionary loaded (extension)
  assert.equal(run(none, "t('Sent.')"), 'Sent.');
});

test('t() translates with the German dictionary', () => {
  const de = page({ languages: ['de-DE'] });
  assert.equal(run(de, "t('Sent.')"), 'Gesendet.');
  assert.equal(run(de, "t('Download failed: {msg}', { msg: 'boom' })"), 'Download fehlgeschlagen: boom');
  assert.equal(run(de, "t('not in the dictionary {x}', { x: 1 })"), 'not in the dictionary 1');
  assert.equal(run(de, "t('constructor')"), 'constructor');           // no prototype lookups
  assert.equal(run(de, "progress({ url: 'u', status: 'downloading', percent: 40 }, new Map()).verb"), 'lädt 20 %');
});

test('language pick from navigator.languages', () => {
  const lang = (o) => {
    const ctx = page(o);
    return { html: ctx.document.documentElement.lang, german: run(ctx, "t('Sent.')") === 'Gesendet.' };
  };
  for (const o of [{ languages: ['de-DE'] }, { languages: ['de'] }, { languages: ['de-AT', 'en'] }, { languages: ['DE-ch'] },
    { languages: [], language: 'de-DE' }, { languages: undefined, language: 'de' }]) {
    assert.deepEqual(lang(o), { html: 'de', german: true }, JSON.stringify(o));
  }
  for (const o of [{ languages: ['en-US'] }, { languages: ['fr'] }, { languages: ['en-US', 'de'] }, { languages: ['dev'] },
    { languages: [], language: 'en-GB' }, { languages: undefined, language: undefined }]) {
    assert.deepEqual(lang(o), { html: 'en', german: false }, JSON.stringify(o));
  }
});

// ---- Coverage: every UI string has an entry, no entry is stale ---------------

const literal = (src) => vm.runInNewContext(src);
const normalize = (s) => s.trim().replace(/\s+/g, ' ');

function usedKeys() {
  const keys = new Map();   // key -> where
  const add = (k, where) => { if (!keys.has(k)) keys.set(k, where); };
  // t('...') in web/*.js (not the t() definition itself: its argument is a variable).
  for (const f of fs.readdirSync(root).filter((n) => n.endsWith('.js') && n !== 'sw.js')) {
    for (const m of read(f).matchAll(/(?<![\w.$])t\(\s*('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*")/g)) add(literal(m[1]), f);
  }
  // data-i18n elements (key = inner HTML) and attributes in index.html.
  const html = read('index.html');
  for (const m of html.matchAll(/<([a-z0-9]+)\b[^>]*\sdata-i18n(?=[\s>=])[^>]*>([\s\S]*?)<\/\1>/g)) add(normalize(m[2]), 'index.html');
  for (const m of html.matchAll(/\s(?:placeholder|aria-label|title)="([^"]*)"/g)) add(m[1], 'index.html');
  // Keys that reach t() through a variable.
  const ctx = page({ languages: ['en'] });
  for (const v of Object.values(run(ctx, 'VERBS'))) add(v, 'VERBS');
  for (const f of run(ctx, 'FORMATS')) add(f.label, 'FORMATS');
  add(run(ctx, 'PREF_OPTIONS.videoQuality[0][1]'), 'PREF_OPTIONS');
  return keys;
}

test('every UI string has a German entry and de.js has no stale keys', () => {
  const used = usedKeys();
  assert.ok(used.size > 80, 'found only ' + used.size + ' strings, extraction broken?');
  const dict = run(page({ languages: ['de'] }), 'window.I18N');
  const missing = [...used].filter(([k]) => !Object.hasOwn(dict, k)).map(([k, w]) => w + ': ' + k);
  const stale = Object.keys(dict).filter((k) => !used.has(k));
  assert.deepEqual(missing, [], 'missing in web/i18n/de.js');
  assert.deepEqual(stale, [], 'stale in web/i18n/de.js');
});

test('translations keep the {placeholders} of their English text', () => {
  const dict = run(page({ languages: ['de'] }), 'window.I18N');
  const names = (s) => (s.match(/\{\w+\}/g) || []).sort().join();
  for (const [k, v] of Object.entries(dict)) assert.equal(names(v), names(k), k);
});
