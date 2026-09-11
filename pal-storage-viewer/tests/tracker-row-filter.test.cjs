const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const decorator = () => () => {};
const context = { exports: {}, require: name => name === '@angular/core'
  ? { Component: decorator, Input: decorator, ViewChild: decorator, ChangeDetectionStrategy: { OnPush: 0 } } : {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../src/app/completion/completion.component.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true },
}).outputText, context);
function tracker(key = 'crafting') {
  const items = ['done', 'todo', 'active', 'todo', 'active'].map((state, order) => ({
    id: String(order), name: 'Item ' + order, detail: order === 3 ? 'Schematic' : '', coords: '', state, order, group: order % 2 ? 'odd' : 'even',
  }));
  return Object.assign(Object.create(context.exports.CompletionComponent.prototype), {
    selectedCategory: key, summary: { categories: [{ key, items }] }, orderedRows: new WeakMap(),
    search: '', groupFilter: '', prioritizeNotDone: true,
  });
}
const ids = component => Array.from(component.visibleItems, item => item.id);

test('row filtering reuses results until the category, search, group, or priority changes', () => {
  const component = tracker();
  const initial = component.visibleItems;
  assert.strictEqual(component.visibleItems, initial);
  assert.deepEqual(ids(component), ['1', '2', '3', '4', '0']);
  component.search = 'SCHEMATIC';
  const searched = component.visibleItems;
  assert.deepEqual(ids(component), ['3']);
  assert.strictEqual(component.visibleItems, searched);
  component.search = ' schematic ';
  assert.strictEqual(component.visibleItems, searched);
  component.search = ''; component.groupFilter = 'even';
  assert.deepEqual(ids(component), ['2', '4', '0']);
  component.groupFilter = ''; component.prioritizeNotDone = false;
  assert.deepEqual(ids(component), ['0', '1', '2', '3', '4']);
  const replacement = { ...component.category, items: [component.category.items[0]] };
  component.summary = { categories: [replacement] };
  assert.deepEqual(ids(component), ['0']);
});

test('cached mission sorting keeps active, missing, and done groups and does not mutate source rows', () => {
  for (const key of ['mainQuests', 'sideQuests']) {
    const component = tracker(key);
    assert.deepEqual(ids(component), ['2', '4', '1', '3', '0']);
    assert.deepEqual(component.category.items.map(item => item.id), ['0', '1', '2', '3', '4']);
    component.prioritizeNotDone = false;
    assert.deepEqual(ids(component), ['0', '1', '2', '3', '4']);
  }
});
