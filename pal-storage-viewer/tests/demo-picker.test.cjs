const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'resources/demo-saves/catalog.json')));
const decorator = () => () => {};
function appHarness(fetch) {
  const context = { exports: {}, File, AbortController, Error, clearTimeout, setTimeout: fn => { fn(); }, document: { querySelector: () => null }, fetch,
    require: name => name === '@angular/core' ? { Component: decorator, ViewChild: decorator, HostListener: decorator }
      : name === '../backend/wgs' ? { resolveWgsFiles: async inputs => inputs } : {} };
  const source = fs.readFileSync(require.resolve('../src/app/app.component.ts'), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true } }).outputText, context);
  const app = Object.assign(Object.create(context.exports.AppComponent.prototype), {
    isParsing: false, isDemoPickerOpen: true, pendingDemo: catalog[0], pendingFiles: [{ input: { path: 'old.sav' }, folder: 'old', size: 5 }],
    pendingFolders: [], pendingIgnored: 0, pendingAppend: false, originalRows: [], saveSets: [], sources: [],
    parser: { isCandidate: () => true, previewFiles: async () => {} }, changeDetector: { markForCheck() {} },
    parseInputs: () => { throw Error('Must not load before confirmation'); },
  });
  return app;
}
const success = async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer });

test('every demo has an obtainable source, safe unique asset paths, and accurate download sizes', () => {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../src/app/demo-catalog.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, module);
  assert.deepEqual(JSON.parse(JSON.stringify(module.exports.DEFAULT_DEMO)), catalog[0]);
  assert.equal(catalog.length, 35);
  assert.equal(new Set(catalog.map(d => d.id)).size, catalog.length);
  for (const demo of catalog) {
    assert.match(demo.sourceUrl, /^https:\/\/(github\.com|www\.nexusmods\.com|www\.reddit\.com|www\.playground\.ru)\//);
    assert(demo.name && demo.summary && demo.files.length);
    assert(Number.isInteger(demo.summary.players) && demo.summary.players > 0);
    assert(demo.summary.percent === null || demo.summary.percent >= 0 && demo.summary.percent <= 100);
    assert.equal(new Set(demo.files.map(f => f.path)).size, demo.files.length);
    let bytes = 0;
    for (const file of demo.files) {
      assert.match(file.url, /^resources\/(demo-saves|example_save)\//);
      assert(!file.url.includes('..') && !file.path.includes('..') && !file.path.startsWith('/'));
      assert(!file.path.toLowerCase().includes('backup/'));
      const size = fs.statSync(path.join(root, file.url)).size;
      assert.equal(file.bytes, size);
      assert(size < 100 * 1024 * 1024);
      bytes += size;
    }
    assert.equal(demo.bytes, bytes);
  }
  assert(!catalog.some(d => /gamepass|xbox|empty dedicated/i.test(d.name)));
});

test('switching replaces the pending files and keeps a single-file demo behind the Load confirmation', async () => {
  const fetched = [];
  const app = appHarness(async url => { fetched.push(url); return success(); });
  const demo = catalog.find(d => d.files.length === 1);
  await app.loadDemoSave(demo);
  assert.deepEqual(fetched, demo.files.map(f => f.url));
  assert.equal(app.pendingFiles.length, 1);
  assert.equal(app.pendingFiles[0].input.path, demo.files[0].path);
  assert.equal(app.pendingDemo.id, demo.id);
  assert.equal(app.isDemoPickerOpen, false);
  assert.equal(app.isParsing, false);
});

test('failed downloads preserve the previous preview and report the error in the picker', async () => {
  const app = appHarness(async () => ({ ok: false, status: 503 }));
  const previous = app.pendingFiles;
  await app.loadDemoSave(catalog[1]);
  assert.equal(app.pendingFiles, previous);
  assert.equal(app.pendingDemo, catalog[0]);
  assert.equal(app.isDemoPickerOpen, true);
  assert.match(app.demoDownloadError, /503/);
  assert.equal(app.isParsing, false);
});

test('cancel aborts an in-flight switch and late responses cannot replace the previous preview', async () => {
  let signal, finish;
  const app = appHarness((_url, options) => { signal = options.signal; return new Promise(resolve => { finish = resolve; }); });
  const previous = app.pendingFiles;
  const demo = catalog.find(d => d.files.length === 1);
  const loading = app.loadDemoSave(demo);
  app.closeDemoPicker();
  assert.equal(signal.aborted, true);
  finish(await success());
  await loading;
  assert.equal(app.pendingFiles, previous);
  assert.equal(app.pendingDemo, catalog[0]);
  assert.equal(app.isParsing, false);
});

test('choosing the current demo preserves preview edits and downloads nothing', async () => {
  const app = appHarness(() => { throw Error('Unexpected download'); });
  const previous = app.pendingFiles;
  await app.loadDemoSave(catalog[0]);
  assert.equal(app.pendingFiles, previous);
  assert.equal(app.isDemoPickerOpen, false);
});
