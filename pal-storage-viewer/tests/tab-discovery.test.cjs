const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { TabDiscovery } = require('../src/app/tab-discovery.ts');

test('only an unvisited inactive tab pings while a save is loaded', () => {
  const tabs = new TabDiscovery(null);
  tabs.visit('pals', true);
  assert.equal(tabs.shouldPing('tracker', 'pals', false), false);
  assert.equal(tabs.shouldPing('pals', 'pals', true), false);
  assert.equal(tabs.shouldPing('tracker', 'pals', true), true);
  tabs.visit('tracker', true);
  assert.equal(tabs.shouldPing('tracker', 'pals', true), false);
  assert.equal(tabs.shouldPing('pals', 'tracker', true), false);
  const deepLink = new TabDiscovery(null);
  deepLink.visit('tracker', true);
  assert.equal(deepLink.shouldPing('pals', 'tracker', true), true);
});

test('visited tabs remain dismissed after reloading and broken storage is tolerated', () => {
  let saved = 'invalid JSON';
  const storage = { getItem: () => saved, setItem: (_, value) => { saved = value; } };
  const tabs = new TabDiscovery(storage);
  assert.equal(tabs.shouldPing('tracker', 'pals', true), true);
  tabs.visit('tracker', true);
  assert.equal(new TabDiscovery(storage).shouldPing('tracker', 'pals', true), false);
  const blocked = new TabDiscovery({ getItem() { throw Error(); }, setItem() { throw Error(); } });
  blocked.visit('tracker', true);
  assert.equal(blocked.shouldPing('tracker', 'pals', true), false);
});

test('switching tabs before loading does not count, even with old stored flags', () => {
  const saved = new Map([['pal-viewer.visited-tabs', '["pals","tracker"]']]);
  const storage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) };
  const tabs = new TabDiscovery(storage);
  tabs.visit('pals', false);
  tabs.visit('tracker', false);
  assert.equal(saved.has('pal-viewer.visited-loaded-tabs'), false);
  assert.equal(tabs.shouldPing('pals', 'tracker', false), false);
  // A save finishes loading with Tracker active. Pal Table has not been visited.
  tabs.visit('tracker', true);
  assert.equal(tabs.shouldPing('pals', 'tracker', true), true);
  assert.equal(tabs.shouldPing('tracker', 'tracker', true), false);
  assert.equal(new TabDiscovery(storage).shouldPing('pals', 'tracker', true), true);
  tabs.visit('pals', true);
  assert.equal(tabs.shouldPing('pals', 'tracker', true), false);
});
