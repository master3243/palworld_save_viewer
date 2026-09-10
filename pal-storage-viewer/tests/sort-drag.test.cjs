const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function builder() {
  const decorator = () => () => {};
  const context = {
    exports: {},
    require: name => name === '@angular/core' ? {
      Component: decorator, Input: decorator, Output: decorator, HostListener: decorator,
      EventEmitter: class { count = 0; emit() { this.count++; } },
    } : {},
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../src/app/filter/filter-builder.component.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true },
  }).outputText, context);
  const component = new context.exports.FilterBuilderComponent();
  component.sorts = ['defense', 'attack', 'max_hp'].map((field, i) => ({ field, direction: i === 1 ? 'asc' : 'desc' }));
  const rows = component.sorts.map((_, i) => ({ getBoundingClientRect: () => ({ top: i * 50, height: 40 }) }));
  for (const row of rows) {
    let captured = false;
    Object.assign(row, {
      parentElement: { querySelectorAll: () => rows },
      setPointerCapture: () => { captured = true; },
      hasPointerCapture: () => captured,
      releasePointerCapture: () => { captured = false; },
    });
  }
  const event = (index, y, extra = {}) => ({
    button: 0, isPrimary: true, pointerId: 1, clientY: y,
    currentTarget: rows[index], target: { closest: () => null }, preventDefault() {}, ...extra,
  });
  return { component, event };
}

test('dragging sort rows changes priority once on release and preserves criteria', () => {
  const { component, event } = builder();
  const original = [...component.sorts];
  component.startSortDrag(event(0, 20), 0);
  component.moveSortDrag(event(0, 125));
  assert.equal(component.sortDrag.to, 2);
  assert.deepEqual(component.sorts, original);
  assert.equal(component.changed.count, 0);
  component.endSortDrag(event(0, 125));
  assert.deepEqual(component.sorts, [original[1], original[2], original[0]]);
  assert.equal(component.changed.count, 1);
  assert.equal(component.sortDrag, null);

  component.startSortDrag(event(2, 120), 2);
  component.moveSortDrag(event(2, -10));
  component.endSortDrag(event(2, -10));
  assert.deepEqual(component.sorts, original);
  assert.equal(component.changed.count, 2);
});

test('clicks, canceled drags, other pointers and form controls do not reorder sorts', () => {
  const { component, event } = builder();
  const original = [...component.sorts];
  component.startSortDrag(event(0, 20), 0);
  component.moveSortDrag(event(0, 22));
  component.endSortDrag(event(0, 22));
  component.startSortDrag(event(0, 20), 0);
  component.moveSortDrag(event(0, 140, { pointerId: 2 }));
  assert.equal(component.sortDrag.active, false);
  component.moveSortDrag(event(0, 140));
  component.endSortDrag(event(0, 140), false);
  component.startSortDrag(event(0, 20, { target: { closest: selector => selector.includes('select') ? {} : null } }), 0);
  assert.equal(component.sortDrag, null);
  component.startSortDrag(event(0, 20), 0);
  component.moveSortDrag(event(0, 140));
  component.cancelSortDrag();
  assert.deepEqual(component.sorts, original);
  assert.equal(component.changed.count, 0);
});

test('keyboard priority moves stay within the list bounds', () => {
  const { component } = builder();
  const original = [...component.sorts];
  component.moveSort(0, -1);
  component.moveSort(2, 1);
  assert.deepEqual(component.sorts, original);
  component.moveSort(1, -1);
  assert.deepEqual(component.sorts, [original[1], original[0], original[2]]);
  assert.equal(component.changed.count, 1);
});
