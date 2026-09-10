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
      if (name === '@angular/core') return { Component: decorator, Input: decorator, ViewChild: decorator };
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
