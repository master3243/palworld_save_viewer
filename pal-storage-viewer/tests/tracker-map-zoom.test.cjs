const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const options = { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true };
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: options,
}).outputText, filename);
const model = require('../src/app/completion/tracker-map-model.ts');

function mapHarness() {
  let id = 0;
  const frames = new Map(), layouts = [];
  const decorator = () => () => {};
  const context = {
    exports: {},
    setTimeout: () => assert.fail('Zoom grouping must not schedule a timer'),
    requestAnimationFrame: fn => { frames.set(++id, fn); return id; },
    cancelAnimationFrame: id => frames.delete(id),
    require: name => name === '@angular/core' ? {
      Component: decorator, Input: decorator, Output: decorator, ViewChild: decorator, HostListener: decorator,
      EventEmitter: class {},
    } : name === './tracker-map-model' ? {
      ...model, layoutMapMarkers: (...args) => { layouts.push(args[2]); return model.layoutMapMarkers(...args); },
    } : {},
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../src/app/completion/tracker-map.component.ts'), 'utf8'), {
    compilerOptions: options,
  }).outputText, context);
  const component = new context.exports.TrackerMapComponent({}, { runOutsideAngular: fn => fn() });
  const ctx = new Proxy({}, { get: (target, key) => target[key] ?? (() => {}) });
  component.canvas = { nativeElement: { width: 400, height: 400, getContext: () => ctx } };
  component.width = component.height = 400;
  component.maps = [{ key: 'palpagos', minX: -100, maxX: 100, minY: -100, maxY: 100 }];
  component.filtered = [0, 2.25, 4.75, 5].map((x, i) => ({ key: String(i), map: 'palpagos', x, y: 0, item: {} }));
  component.drawTerrainDetail = component.drawObjective = component.positionPopup = component.updateNearby = () => {};
  function flush() {
    const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn());
  }
  const zoomTo = zoom => { component.zoomBy(zoom / component.zoom, { x: 100, y: 100 }); flush(); };
  component.draw();
  return { component, layouts, frames, zoomTo, flush };
}

test('grouping waits for a 1.25x zoom step while positions and hit targets move smoothly', () => {
  const { component, layouts, zoomTo } = mapHarness();
  component.filtered = [0, 3.65].map((x, i) => ({ key: String(i), map: 'palpagos', x, y: 0, item: {} }));
  component.draw();
  const initialLayouts = layouts.length;
  for (const zoom of [1.01, 1.1, 1.24]) {
    zoomTo(zoom);
    assert.equal(component.clusters.length, 1);
    assert.equal(layouts.length, initialLayouts);
    const point = component.screen({x:1.825,y:0});
    assert.equal(component.markerAt(point).items.length, 2);
    assert.ok(Math.abs(component.clusters[0].x - point.x) < 1e-8);
    assert.ok(Math.abs(component.clusters[0].y - point.y) < 1e-8);
  }
  zoomTo(1.25);
  assert.equal(component.clusters.length, 2);
  assert.equal(layouts.length, initialLayouts + 1);
  for (const zoom of [1.24, 1.1, 1.2]) {
    zoomTo(zoom);
    assert.equal(component.clusters.length, 2);
    assert.equal(layouts.length, initialLayouts + 1);
  }
  zoomTo(1);
  assert.equal(component.clusters.length, 1);
  assert.equal(layouts.length, initialLayouts + 2);
});

test('panning and redraws reuse grouping while zoom and data changes recalculate it', () => {
  const { component, layouts, zoomTo } = mapHarness();
  component.center.x += .1; component.draw(); component.draw();
  assert.equal(layouts.length, 1);
  zoomTo(1.3);
  assert.equal(layouts.length, 2);
  component.filtered = [component.filtered[0]]; component.draw();
  assert.equal(layouts.length, 3);
  assert.equal(component.clusters[0].items.length, 1);
  component.route = [component.filtered[0]]; component.draw();
  assert.equal(layouts.length, 4);
  component.width = 350; component.draw();
  assert.equal(layouts.length, 5);
  component.maps = [{...component.maps[0], minX:-200}]; component.draw();
  assert.equal(layouts.length, 6);
});

test('destroying the map cancels its pending animation frame', () => {
  const { component, layouts, frames, flush } = mapHarness();
  component.zoomBy(1.5); component.ngOnDestroy();
  assert.equal(frames.size, 0);
  flush(); assert.deepEqual(layouts, [400]);
});

function popupHarness() {
  const { component } = mapHarness();
  component.canvas.nativeElement.getBoundingClientRect = () => ({ left: 0, top: 0 });
  const [first, second, ...group] = component.filtered;
  component.clusters = [
    { x: 50, y: 200, items: [first] },
    { x: 150, y: 200, items: [second] },
    { x: 250, y: 200, items: group },
  ];
  const move = x => component.pointerMove({ pointerId: 1, pointerType: 'mouse', clientX: x, clientY: 200 });
  const click = x => component.canvasClick({ clientX: x, clientY: 200 });
  return { component, first, second, group, move, click };
}

test('the drawn bubble count and hover preview agree for coincident objectives', () => {
  const { component } = mapHarness();
  component.filtered = [-30, -20, -10, 0, 0, 0, 0, 0, 10, 20, 30].map((x, i) => ({
    key: String(i), map: 'palpagos', x, y: 0, item: {},
  }));
  const labels = [];
  component.canvas.nativeElement.getContext().fillText = (text, x, y) => labels.push({ text, x, y });
  component.canvas.nativeElement.getBoundingClientRect = () => ({ left: 0, top: 0 });
  component.draw();
  component.pointerMove({ pointerId: 1, pointerType: 'mouse', clientX: 200, clientY: 200 });
  const atLocation = labels.filter(label => label.x === 200 && label.y === 200);
  assert.deepEqual(atLocation.map(label => label.text), ['5']);
  assert.equal(component.hoverCluster.items.length, 5);
  component.canvasClick({ clientX: 200, clientY: 200 });
  assert.equal(component.clusterItems.length, 5);
});

test('a clicked objective stays pinned while other objectives and groups have independent previews', () => {
  const { component, first, second, group, move, click } = popupHarness();
  click(50);
  for (const x of [150, 250, 350, 150, 50]) {
    move(x);
    assert.strictEqual(component.selected, first);
    assert.equal(component.popupPinned, true);
    assert.equal(component.clusterItems.length, 0);
    assert.strictEqual(component.hovered, x === 150 ? second : null);
    assert.strictEqual(component.hoverCluster?.items ?? null, x === 250 ? group : null);
  }
  component.leaveMap();
  assert.strictEqual(component.selected, first);
  assert.equal(component.hovered, null);
  assert.equal(component.hoverCluster, null);
  click(150);
  assert.strictEqual(component.selected, second);
  assert.equal(component.popupPinned, true);
  component.clearSelection();
  move(50);
  assert.strictEqual(component.hovered, first);
  assert.equal(component.popupPinned, false);
});

test('a clicked marker group stays pinned alongside hover previews without previewing itself', () => {
  const { component, first, second, group, move, click } = popupHarness();
  click(250);
  const anchor = component.clusterAnchor;
  for (const x of [50, 150, 350, 250]) {
    move(x);
    assert.equal(component.selected, null);
    assert.strictEqual(component.clusterItems, group);
    assert.strictEqual(component.clusterAnchor, anchor);
    assert.equal(component.popupPinned, true);
    assert.strictEqual(component.hovered, x === 50 ? first : x === 150 ? second : null);
    assert.equal(component.hoverCluster, null);
  }
  click(350);
  assert.equal(component.popupPinned, false);
  assert.equal(component.clusterItems.length, 0);
  move(250);
  assert.strictEqual(component.hoverCluster.items, group);
  assert.equal(component.popupPinned, false);
  move(50);
  assert.strictEqual(component.hovered, first);
  assert.equal(component.hoverCluster, null);
});
