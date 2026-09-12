const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const decorator = () => () => {};
function load(file, modules = {}) {
  const context = { exports: {}, Error, clearTimeout, setTimeout: (fn, ms) => setTimeout(fn, ms).unref(), require: name => modules[name] ?? (name === '@angular/core'
    ? { Component: decorator, Injectable: decorator, ViewChild: decorator, HostListener: decorator } : {}) };
  const source = fs.readFileSync(require.resolve(file), 'utf8').replaceAll('import.meta.url', '"https://example.test/"');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true,
  } }).outputText, context);
  return context.exports;
}
const service = load('../src/app/save-parser.service.ts');
const { AppComponent } = load('../src/app/app.component.ts', { './save-parser.service': service });
const message = 'Provided files were not identified as Palworld saves';
const input = name => ({ path: name, file: { name, size: 1 } });
const player = input('player.sav'), meta = input('LevelMeta.sav'), local = input('LocalData.sav');
function harness(inputs) {
  const parser = new service.SaveParserService();
  parser.runInWorker = async files => ({ rows: [], sources: files.map(f => ({ file: f.name, note: 'World metadata' })),
    sets: [{ players: files.filter(f => f.name.startsWith('player')).map(f => ({ completion: {}, uid: f.name })) }] });
  const app = Object.assign(Object.create(AppComponent.prototype), {
    parser, loadedInputs: inputs, sources: inputs.map(i => ({ file: i.file.name })),
    saveSets: [{ players: [{ completion: {} }] }], originalRows: [], rows: [],
    locationCounts: [], isSourcesOpen: true, isParsing: false, saveLetters: new Map(),
    changeDetector: { markForCheck() {} }, tabDiscovery: { visit() {} },
    assignSaveLetters() {}, scheduleMeasure() {}, defaultOrder: rows => rows, buildColumns: () => [],
  });
  return { app, parser };
}

test('removing the last player with supporting files left clears stale data and returns to the menu', async () => {
  const { app } = harness([meta, player, local]);
  await app.removeSource(1);
  assert.equal(app.hasData, false);
  for (const key of ['loadedInputs', 'sources', 'saveSets', 'rows', 'locationCounts']) assert.equal(app[key].length, 0);
  assert.equal(app.error, message);
  assert.equal(app.isSourcesOpen, false);
  assert.equal(app.isParsing, false);
  assert.equal(app.progress, null);
});

test('removing a save group also clears the view when only supporting files remain', async () => {
  const { app } = harness([player, meta]);
  await app.removeSaveGroup({ sources: [{ index: 0 }] });
  assert.equal(app.hasData, false);
  assert.equal(app.loadedInputs.length, 0);
  assert.equal(app.error, message);
});

test('removing a player retains another player and removing the final file returns cleanly', async () => {
  const { app } = harness([player, input('player2.sav')]);
  await app.removeSource(0);
  assert.equal(app.hasData, true);
  assert.equal(app.loadedInputs.length, 1);
  assert.equal(app.sources[0].file, 'player2.sav');
  assert.equal(app.error, '');
  await app.removeSource(0);
  assert.equal(app.hasData, false);
  assert.equal(app.error, '');
});

test('empty results use the requested message but real parser failures are not mistaken for empty results', async () => {
  const { parser, app } = harness([player, meta]);
  await assert.rejects(parser.parseMany([meta]), { message });
  await assert.rejects(parser.parseMany([input('notes.txt')]), { message });
  parser.runInWorker = async () => { throw new Error('Worker failed'); };
  await app.removeSource(0);
  assert.equal(app.error, 'Worker failed');
  assert.equal(app.loadedInputs.length, 2);
});

test('removal waits until parsing finishes so overlapping removals cannot restore a stale selection', async () => {
  const { app } = harness([player, meta]);
  app.isParsing = true;
  await app.removeSource(0);
  await app.removeSaveGroup({ sources: [{ index: 0 }] });
  assert.equal(app.loadedInputs.length, 2);
});
