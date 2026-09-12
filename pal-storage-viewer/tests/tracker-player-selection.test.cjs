const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function tracker() {
  let resolveData;
  const catalog = new Promise(resolve => { resolveData = resolve; });
  const decorator = () => () => {};
  const context = {
    exports: {},
    require: name => {
      if (name === '@angular/core') return { Component: decorator, Input: decorator, ViewChild: decorator, ChangeDetectionStrategy: { OnPush: 0 } };
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
  assert.ok(warning.titleSegments.some(s => s.text === 'Player 0' && s.tone === 'warning'));
  assert.ok(warning.lineSegments[0].some(s => s.text === 'Player 1' && s.tone === 'success'));
  assert.ok(warning.lineSegments[1].some(s => s.text === 'Player 0' && s.tone === 'warning'));
  assert.ok(warning.lineSegments[1].some(s => s.text === 'Player 1' && s.tone === 'success'));
});
