const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function harness() {
  const observers = [];
  const document = { activeElement: null, createElement: () => ({
    style: {}, remove() { this.parent?.children.splice(this.parent.children.indexOf(this), 1); },
  }) };
  const decorator = () => () => {};
  const context = { exports: {}, document, require: () => ({ Directive: decorator, Injectable: decorator, Input: decorator }),
    IntersectionObserver: class {
      constructor(callback) { this.callback = callback; this.observed = new Set(); this.disconnected = false; observers.push(this); }
      observe(row) { this.observed.add(row); }
      unobserve(row) { this.observed.delete(row); }
      disconnect() { this.disconnected = true; }
      emit(entries) { this.callback(entries.map(([target, isIntersecting, height = 36]) => ({ target, isIntersecting, boundingClientRect: { height } }))); }
    },
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../src/app/completion/table-row-viewport.directive.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true },
  }).outputText, context);
  let batches = 0;
  const viewport = new context.exports.TableRowViewport({ runOutsideAngular: fn => fn(), run: fn => { batches++; return fn(); } });
  const listeners = new Map();
  const root = { addEventListener: (type, fn) => listeners.set(type, fn), removeEventListener: type => listeners.delete(type) };
  function row() {
    const element = { children: [], attributes: {}, offsetHeight: 80, expanded: false,
      appendChild(child) { child.parent = this; this.children.push(child); },
      setAttribute(key, value) { this.attributes[key] = value; },
      removeAttribute(key) { delete this.attributes[key]; },
      contains(target) { return target === this; },
      closest() { return this; },
      querySelector() { return this.expanded; },
    };
    const counts = { rendered: 0, cleared: 0 };
    const directive = new context.exports.TableRowViewportDirective({ nativeElement: { parentElement: element } }, {}, {
      createEmbeddedView() { counts.rendered++; return { detectChanges() {} }; },
      clear() { counts.cleared++; },
    }, viewport, { markForCheck() {} });
    Object.assign(directive, { tableRowViewport: root, tableRowViewportColumns: 11, tableRowViewportHeight: 38 });
    directive.ngOnChanges();
    return { element, directive, counts };
  }
  return { row, viewport, observers, document, listeners, batches: () => batches };
}

test('large tables share one observer and only render cells for rows entering its viewport', () => {
  const h = harness(), rows = Array.from({ length: 1273 }, () => h.row());
  assert.equal(h.observers.length, 1);
  assert.ok(rows.every(row => row.counts.rendered === 0 && row.element.attributes['aria-hidden'] === 'true'));
  h.observers[0].emit(rows.slice(0, 3).map(row => [row.element, true]));
  assert.equal(h.batches(), 1);
  assert.ok(rows.slice(0, 3).every(row => row.counts.rendered === 1 && row.element.children.length === 0));
  assert.ok(rows.slice(3).every(row => row.counts.rendered === 0));
  for (const row of rows) row.directive.ngOnDestroy();
  assert.equal(h.observers[0].observed.size, 0);
  assert.equal(h.observers[0].disconnected, true);
  assert.equal(h.listeners.size, 0);
});

test('off-screen cells are released without losing measured height, and map targets can be revealed immediately', () => {
  const h = harness(), row = h.row();
  h.observers[0].emit([[row.element, true]]);
  h.observers[0].emit([[row.element, false, 94]]);
  assert.equal(row.counts.cleared, 1);
  assert.equal(row.element.children[0].style.height, '94px');
  assert.equal(row.element.children[0].colSpan, 11);
  h.viewport.reveal(row.element);
  assert.equal(row.counts.rendered, 2);
  assert.equal(row.element.attributes['aria-hidden'], undefined);
});

test('keyboard focus renders a deferred row before the next viewport observation', () => {
  const h = harness(), row = h.row();
  h.listeners.get('focusin')({ target: row.element });
  assert.equal(row.counts.rendered, 1);
  assert.equal(row.element.attributes['aria-hidden'], undefined);
});

test('expanded recipes and keyboard focus survive scrolling outside the viewport', () => {
  const h = harness(), row = h.row();
  h.observers[0].emit([[row.element, true]]);
  row.element.expanded = true;
  h.observers[0].emit([[row.element, false, 150]]);
  assert.equal(row.counts.cleared, 0);
  row.element.expanded = false;
  h.document.activeElement = row.element;
  h.observers[0].emit([[row.element, false]]);
  assert.equal(row.counts.cleared, 0);
  h.document.activeElement = null;
  h.observers[0].emit([[row.element, false]]);
  assert.equal(row.counts.cleared, 1);
});
