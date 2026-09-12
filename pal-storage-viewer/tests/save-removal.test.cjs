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
    sets: [{ folder: 'world', has_local_data: files.some(f => f.name === 'LocalData.sav'), players: files.filter(f => f.name.startsWith('player')).map(f => ({ completion: {}, uid: f.name })) }] });
  const app = Object.assign(Object.create(AppComponent.prototype), {
    parser, loadedInputs: inputs, sources: inputs.map(i => ({ file: i.file.name })),
    saveSets: [{ players: [{ completion: {} }] }], originalRows: [], rows: [],
    locationCounts: [], isSourcesOpen: true, isParsing: false, saveLetters: new Map(), localDataOwners: new Map(),
    changeDetector: { markForCheck() {} }, tabDiscovery: { visit() {} },
    assignSaveLetters() {}, scheduleMeasure() {}, defaultOrder: rows => rows, buildColumns: () => [],
  });
  return { app, parser };
}

test('removing the last player with supporting files left clears stale data and returns to the menu', async () => {
  const { app } = harness([meta, player, local]);
  app.localDataOwners.set('world', 'player.sav');
  await app.removeSource(1);
  assert.equal(app.hasData, false);
  for (const key of ['loadedInputs', 'sources', 'saveSets', 'rows', 'locationCounts']) assert.equal(app[key].length, 0);
  assert.equal(app.error, message);
  assert.equal(app.isSourcesOpen, false);
  assert.equal(app.isParsing, false);
  assert.equal(app.progress, null);
  assert.equal(app.localDataOwners.size, 0);
});

test('LocalData ownership survives unrelated removal and is cleared when its owner is removed', async () => {
  const { app } = harness([player, input('player2.sav'), input('player3.sav'), local]);
  app.localDataOwners.set('world', 'player.sav');
  await app.removeSource(1);
  assert.equal(app.localDataOwners.get('world'), 'player.sav');
  await app.removeSource(0);
  assert.equal(app.hasData, true);
  assert.equal(app.localDataOwners.size, 0);
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

test('adding a save preserves the displayed data until the new result is ready', async () => {
  const { app, parser } = harness([player]);
  const oldRows = [{ pal_name: 'Existing Pal' }];
  app.rows = app.originalRows = app.filteredRows = oldRows;
  app.columns = [{ key: 'pal_name' }];
  app.sorts = [{ key: 'pal_name', direction: 'asc' }];
  app.scrollTop = 400;
  const oldSets = app.saveSets, oldSources = app.sources, oldColumns = app.columns;
  let complete;
  parser.parseMany = () => new Promise(resolve => { complete = resolve; });
  const loading = app.parseInputs([input('player2.sav')], true);
  assert.equal(app.isParsing, true);
  assert.equal(app.rows, oldRows);
  assert.equal(app.originalRows, oldRows);
  assert.equal(app.saveSets, oldSets);
  assert.equal(app.sources, oldSources);
  assert.equal(app.columns, oldColumns);
  assert.equal(app.scrollTop, 400);
  assert.equal(app.hasData, true);
  const sets = [{ folder: 'new', players: [{ uid: 'new', completion: {} }] }];
  complete({ rows: [], sets, sources: [{ file: 'player2.sav' }] });
  await loading;
  assert.equal(app.saveSets, sets);
  assert.equal(app.rows.length, 0);
  assert.equal(app.isParsing, false);
  assert.equal(app.progress, null);
});

test('failed additions preserve the current view and owner without reparsing it', async () => {
  const { app, parser } = harness([player, local]);
  const oldRows = [{ pal_name: 'Existing Pal' }];
  app.rows = app.originalRows = app.filteredRows = oldRows;
  app.columns = [{ key: 'pal_name' }];
  app.scrollTop = 400;
  app.localDataOwners.set('world', 'player.sav');
  const oldSets = app.saveSets, oldSources = app.sources, oldInputs = app.loadedInputs;
  let calls = 0;
  parser.parseMany = async () => { calls++; throw new Error('Bad new save'); };
  await app.parseInputs([input('bad.sav')], true);
  assert.equal(calls, 1);
  assert.equal(app.rows, oldRows);
  assert.equal(app.saveSets, oldSets);
  assert.equal(app.sources, oldSources);
  assert.equal(app.loadedInputs, oldInputs);
  assert.equal(app.scrollTop, 400);
  assert.equal(app.localDataOwners.get('world'), 'player.sav');
  assert.equal(app.error, 'Bad new save');
  assert.equal(app.isParsing, false);
});
