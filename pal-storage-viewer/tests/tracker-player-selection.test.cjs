const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText, filename);

function tracker() {
  let resolveData;
  const catalog = new Promise(resolve => { resolveData = resolve; });
  const decorator = () => () => {};
  const context = {
    exports: {},
    require: name => {
      if (name === '@angular/core') return { Component: decorator, Input: decorator, Output: decorator, EventEmitter: class { emit() {} }, ViewChild: decorator, ChangeDetectionStrategy: { OnPush: 0 } };
      if (name === './player-world-progress') return require('../src/app/completion/player-world-progress.ts');
      if (name === '../tab-discovery') return { TabDiscovery: class {} };
      if (name === './completion-data') return { loadCompletionData: () => catalog };
      if (name === './completion-model') return {
        summarize: record => ({ percent: record.percent, categories: [] }),
      };
      return {};
    },
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../src/app/completion/completion.component.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true },
  }).outputText, context);
  return {
    component: new context.exports.CompletionComponent({ markForCheck() {} }),
    async loadData() { resolveData({}); await new Promise(resolve => setImmediate(resolve)); },
  };
}

const set = (...percents) => [{ folder: 'world', players: percents.map((percent, index) => ({
  uid: String(index), name: `Player ${index}`, completion: { percent },
})) }];

test('selects highest completion after the catalog arrives, with stable ties', async () => {
  const { component, loadData } = tracker();
  component.sets = set(20, 80, 80);
  component.ngOnChanges();
  assert.equal(component.selectedPlayer, '');
  await loadData();
  assert.equal(component.selectedPlayer, 'world|1');
  assert.equal(component.summary.percent, 80);
});

test('selects highest completion when saves arrive later and preserves manual selection', async () => {
  const { component, loadData } = tracker();
  await loadData();
  component.sets = set(20, 80, 60);
  component.ngOnChanges();
  assert.equal(component.selectedPlayer, 'world|1');
  component.selectPlayer('world|0');
  component.ngOnChanges();
  assert.equal(component.selectedPlayer, 'world|0');
  component.sets[0].players.shift();
  component.ngOnChanges();
  assert.equal(component.selectedPlayer, 'world|1');
  component.sets = [];
  component.ngOnChanges();
  assert.equal(component.selectedPlayer, '');
  assert.equal(component.summary, null);
});

test('local owner auto-selects only a sole possible player and preserves manual overrides', () => {
  const { component } = tracker();
  const world = set(20, 80)[0];
  world.local_owner_filters = { '0': ['Checked journals do not match.'], '1': [] };
  component.sets = [world];
  assert.equal(component.localDataOwner(world), '1');
  component.localDataOwners.set('world', '0');
  assert.equal(component.localDataOwner(world), '0');
  const warning = component.localDataOwnerWarning(world);
  assert.match(warning.title, /Player "Player 0" is the unlikely owner of LocalData.sav due to:/);
  assert.equal(warning.lines[0], '• Checked journals do not match.');
  assert.equal(component.localDataOwnerWarning(world), warning);
  component.localDataOwners.set('world', '');
  assert.equal(component.localDataOwner(world), '');
  assert.equal(component.localDataOwnerWarning(world), null);
  component.localDataOwners.clear();
  world.local_owner_filters['1'] = ['Tracked quest does not match.'];
  assert.equal(component.localDataOwner(world), '');
  world.players.pop();
  assert.equal(component.localDataOwner(world), '', 'a sole unlikely player is not auto-selected');
  world.local_owner_filters['0'] = [];
  assert.equal(component.localDataOwner(world), '0');
});

test('owner warning highlights selected and ID-identified names with a leading owner line', () => {
  const { component } = tracker();
  const world = set(20, 80)[0];
  world.local_owner_id = '1';
  world.local_owner_filters = { '0': ['Player 0 does not own these Pals. Player 1 owns them.'], '1': [] };
  component.localDataOwners.set('world', '0');
  const warning = component.localDataOwnerWarning(world);
  assert.equal(warning.lines[0], '✓ Owner identified by ID: Player 1');
  assert.ok(warning.titleSegments.some(s => s.text === 'Player 0' && s.tone === 'danger'));
  assert.ok(warning.lineSegments[0].some(s => s.text === 'Player 1' && s.tone === 'success'));
  assert.ok(warning.lineSegments[1].some(s => s.text === 'Player 0' && s.tone === 'danger'));
  assert.ok(warning.lineSegments[1].some(s => s.text === 'Player 1' && s.tone === 'success'));
});


test('likely owner info uses matching evidence and the actual filename while warnings take precedence', () => {
  const { component } = tracker();
  const world = set(20, 80)[0];
  world.local_owner_id = '1';
  world.local_data_file = 'custom-local.sav';
  world.local_owner_filters = { '0': ['Player ID does not match.'], '1': [] };
  world.local_owner_matches = { '0': ['A journal matches.'], '1': ['Player IDs in LocalData.sav match Player 1.'] };
  const info = component.localDataOwnerInfo(world);
  assert.equal(info.title, 'Player "Player 1" is identified as the likely owner of custom-local.sav due to:');
  assert.equal(info.lines[0], '• Player IDs in custom-local.sav match Player 1.');
  assert.equal(component.localDataOwnerInfo(world), info);
  assert.equal(component.localDataOwnerWarning(world), null);
  component.localDataOwners.set('world', '0');
  assert.equal(component.localDataOwnerInfo(world), null);
  assert.ok(component.localDataOwnerWarning(world));
  component.localDataOwners.set('world', '');
  assert.equal(component.localDataOwnerInfo(world), null);
});

test('likely owner info distinguishes inferred matches and avoids unsupported ownership claims', () => {
  const { component } = tracker();
  const world = set(20, 80)[0];
  world.local_owner_filters = { '0': ['Quest mismatch.'], '1': [] };
  world.local_owner_matches = { '0': [], '1': ['Player 1 has started the tracked quest in LocalData.sav.'] };
  const info = component.localDataOwnerInfo(world);
  assert.ok(info.lines.some(line => line.includes('tracked quest')));
  assert.ok(info.lines.some(line => line.includes('No owner was identified by ID')));
  const unknown = set(20,80)[0];
  component.localDataOwners.set('world', '0');
  assert.equal(component.localDataOwnerInfo(unknown), null);
  const sole = set(20)[0];
  assert.ok(component.localDataOwnerInfo(sole).lines.some(line => line.includes('only loaded player')));
  assert.ok(component.localDataOwnerInfo(sole).lines.some(line => line.includes('inferred')));
});


test('unverified selections have their own warning without overlapping likely or conflicting states', () => {
  const { component } = tracker();
  const world = set(20,80)[0];
  world.local_data_file = 'mixed-local.sav';
  component.localDataOwners.set('world', '0');
  const unverified = component.localDataOwnerUnverified(world);
  assert.equal(unverified.title, 'Player "Player 0" is an unverified owner of mixed-local.sav.');
  assert.match(unverified.lines[0], /could not be determined/);
  assert.equal(component.localDataOwnerUnverified(world), unverified);
  assert.equal(component.localDataOwnerWarning(world), null);
  assert.equal(component.localDataOwnerInfo(world), null);
  const conflicting = {...world,local_owner_filters:{'0':['Wrong ID.'],'1':[]}};
  assert.equal(component.localDataOwnerUnverified(conflicting), null);
  assert.ok(component.localDataOwnerWarning(conflicting));
  const likely = {...world,local_owner_matches:{'0':['Matching player ID.']}};
  assert.equal(component.localDataOwnerUnverified(likely), null);
  assert.ok(component.localDataOwnerInfo(likely));
  component.localDataOwners.set('world', '');
  assert.equal(component.localDataOwnerUnverified(world), null);
});
