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
  component.filtered = [0, 9, 19, 20].map((x, i) => ({ key: String(i), map: 'palpagos', x, y: 0, item: {} }));
  component.drawTerrainDetail = component.drawObjective = component.positionPopup = component.updateNearby = () => {};
  function flush() {
    const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn());
  }
  const zoomTo = zoom => { component.zoomBy(zoom / component.zoom, { x: 100, y: 100 }); flush(); };
  component.draw();
  return { component, layouts, frames, zoomTo, flush };
}

test('zoom regrouping waits for a 1.25x step while marker positions and hit targets move smoothly', () => {
  const { component, layouts, zoomTo } = mapHarness();
  assert.equal(component.clusters.length, 1);
  for (const zoom of [1.01, 1.1, 1.2, 1.24]) {
    zoomTo(zoom);
    assert.equal(component.clusters.length, 1);
    const point = component.screen({ x: 12, y: 0 });
    assert.ok(Math.abs(component.clusters[0].x - point.x) < 1e-8);
    assert.ok(Math.abs(component.clusters[0].y - point.y) < 1e-8);
    assert.equal(component.markerAt(point).items.length, 4);
  }
  assert.deepEqual(layouts, [400]);
  zoomTo(1.25);
  assert.deepEqual(layouts, [400, 500]);
  assert.equal(component.markerLayout.size, component.size);
  zoomTo(1.6);
  assert.equal(layouts.length, 3);
  assert.equal(component.clusters.length, 4);
});

test('small zoom reversals do not repeatedly regroup at a boundary', () => {
  const { component, layouts, zoomTo } = mapHarness();
  const hierarchy = component.markerLayout.hierarchy;
  zoomTo(1.5);
  assert.equal(component.clusters.length, 4);
  for (const zoom of [1.45, 1.6, 1.4, 1.5]) zoomTo(zoom);
  assert.equal(layouts.length, 2);
  zoomTo(1.19);
  assert.equal(layouts.length, 3);
  assert.equal(component.clusters.length, 1);
  assert.strictEqual(component.markerLayout.hierarchy, hierarchy);
});

test('filters, trip stops, map changes and viewport resizing bypass the zoom threshold', () => {
  const { component, layouts, zoomTo } = mapHarness();
  let hierarchy = component.markerLayout.hierarchy;
  zoomTo(1.05);
  component.filtered = [component.filtered[0]]; component.draw();
  assert.equal(layouts.length, 2);
  assert.equal(component.clusters[0].items.length, 1);
  assert.notStrictEqual(component.markerLayout.hierarchy, hierarchy);
  hierarchy = component.markerLayout.hierarchy;
  component.route = [component.filtered[0]]; component.draw();
  assert.equal(layouts.length, 3);
  assert.notStrictEqual(component.markerLayout.hierarchy, hierarchy);
  hierarchy = component.markerLayout.hierarchy;
  component.width = 350; component.draw();
  assert.equal(layouts.length, 4);
  assert.strictEqual(component.markerLayout.hierarchy, hierarchy);
  component.maps = [{...component.maps[0], minX:-200}]; component.draw();
  assert.equal(layouts.length, 5);
  assert.notStrictEqual(component.markerLayout.hierarchy, hierarchy);
});

test('destroying the map cancels its pending animation frame', () => {
  const { component, layouts, frames, flush } = mapHarness();
  component.zoomBy(1.5); component.ngOnDestroy();
  assert.equal(frames.size, 0);
  flush(); assert.deepEqual(layouts, [400]);
});
