const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText, filename);
const { worldToMap, mapOf } = require('../src/app/completion/completion-model.ts');
const { CATEGORY_ICONS, mapObjectives, project, unproject, clusterMarkers, layoutMapMarkers, visibleMarkerClusters, nearestTravel, parseCoordinates } = require('../src/app/completion/tracker-map-model.ts');
const maps = require('../../resources/completion/maps/maps.json');
const item = (id, coords, extra={}) => ({id, name:id, coords, map:'', state:'todo', detail:'', group:'', order:0, no:null, ...extra});
const category = (key, items, extra={}) => ({key, title:key, items, ...extra});

test('tracker card and map icons resolve to bundled image data', () => {
  const paths = require('../../resources/completion/maps/icons.json');
  for (const name of new Set([...Object.values(CATEGORY_ICONS), 'Ancient Technology', 'Watchtower'])) {
    assert.ok(paths[name], `Missing icon manifest entry: ${name}`);
    const packed = fs.readFileSync(require('node:path').resolve(__dirname, '../..', paths[name]), 'utf8').trim();
    assert.match(packed, /^data:image\/(?:webp|png|svg\+xml);base64,[A-Za-z0-9+/]+=*$/);
    assert.ok(Buffer.from(packed.split(',')[1], 'base64').length > 0);
  }
});

test('map includes only located, counted objectives from available files, with category-scoped identities', () => {
  const points = mapObjectives([
    category('towers',[item('same','100, -200'),item('missing',''),item('bad','NaN, 1'),item('dlc','1, 1',{counted:false})]),
    category('hard',[item('same','0, 750',{map:'World Tree'})]),
    category('unloaded',[item('hidden','0, 0')],{needsFile:'Level.sav'}),
  ]);
  assert.deepEqual(points.map(p=>[p.key,p.map,p.x,p.y]),[['towers:same','palpagos',100,-200],['hard:same','tree',0,750]]);
});

test('coordinate input accepts signed decimals and rejects partial or malformed values', () => {
  assert.deepEqual(parseCoordinates(' -353.5, 492 '),{x:-353.5,y:492});
  assert.deepEqual(parseCoordinates('0, 0'),{x:0,y:0});
  for(const text of ['','1','1,','1,2,3','1e9,2','Infinity,0','1x,2']) assert.equal(parseCoordinates(text),null);
});

test('main and tree terrain projections use their own readouts and point north upwards', () => {
  const main = maps[0], tree = maps[1];
  assert.deepEqual(worldToMap(-349737,-4254),{x:-353,y:-492});
  assert.equal(mapOf(628792,-610720),'World Tree');
  assert.deepEqual(worldToMap(628792,-610720),{x:28,y:859});
  for (const m of maps) {
    assert.deepEqual(project({x:m.minX,y:m.maxY},m),{x:0,y:0});
    assert.deepEqual(project({x:m.maxX,y:m.minY},m),{x:1,y:1});
    const p={x:(m.minX+m.maxX)/2,y:(m.minY+m.maxY)/2};
    const roundTrip=unproject(project(p,m),m);
    assert(Math.abs(roundTrip.x-p.x)<1e-9 && Math.abs(roundTrip.y-p.y)<1e-9);
  }
  // Rotmist Root: compare normalized position with the original world bounds.
  const pos=project(worldToMap(628792,-610720),tree);
  assert(Math.abs(pos.x-(-610720+818197)/341797)<.003);
  assert(Math.abs(pos.y-(1-(628792-347351.5)/341797))<.003);
  assert(main.minX < -1900 && tree.minX > -130);
});

test('nearest travel excludes locked statues, watchtowers, other maps, and the objective itself', () => {
  const points = mapObjectives([
    category('notes',[item('goal','0, 750',{map:'World Tree'})]),
    category('fastTravel',[
      item('other-map','0, 750',{state:'done',group:'statue'}),
      item('locked','0, 750',{map:'World Tree',group:'statue'}),
      item('watchtower','0, 750',{map:'World Tree',state:'done',group:'other'}),
      item('near','5, 750',{map:'World Tree',state:'done',group:'statue'}),
      item('far','10, 750',{map:'World Tree',state:'done',group:'statue'}),
    ]),
  ]);
  assert.equal(nearestTravel(points[0],points).item.id,'near');
  assert.equal(nearestTravel(points[4],points).item.id,'far');
  assert.equal(nearestTravel(points[0],[]),null);
});

test('clustering groups adjacent grid cells, preserves coincident objectives and splits with zoom', () => {
  const points = mapObjectives([category('notes',[item('a','47, 20'),item('b','49, 20'),item('c','49, 20'),item('d','180, 20'),item('e','48, 21')])]);
  const clusters = clusterMarkers(points,p=>p);
  assert.equal(clusters.length,2);
  assert.deepEqual(clusters.flatMap(c=>c.items.map(p=>p.item.id)).sort(),['a','b','c','d','e']);
  assert.equal(clusterMarkers(points,p=>({x:p.x*30,y:p.y*30})).length,4);
});

test('nearby pairs and triples form bubbles just like larger groups', () => {
  for (let count = 1; count <= 5; count++) {
    const points = mapObjectives([category('notes', Array.from({length:count}, (_,i) => item(String(i),`${i*2}, ${i}`)))]);
    const clusters = clusterMarkers(points,p=>p);
    assert.equal(clusters.length,1);
    assert.equal(clusters.flatMap(c=>c.items).length,count);
    assert.equal(layoutMapMarkers(points, layoutMap, 1000, new Set()).length,1);
    if (count === 1) for (const c of clusters) {
      assert.equal(c.x,c.items[0].x); assert.equal(c.y,c.items[0].y);
    }
  }
});

test('icons that fit separately are not clustered', () => {
  const points = mapObjectives([category('notes',[item('a','0, 0'),item('b','30, 0'),item('c','0, 30')])]);
  assert.equal(clusterMarkers(points,p=>p).length,3);
});

test('rendering keeps precise positions even when coordinate readouts are identical', () => {
  const points = mapObjectives([category('notes',[
    item('a','0, 750',{position:{x:.4,y:750.4}}),
    item('b','0, 750',{position:{x:-.4,y:749.6}}),
  ])]);
  assert.equal(points[0].x,.4);
  assert.equal(points[1].x,-.4);
  assert.equal(clusterMarkers(points,p=>({x:p.x*40,y:p.y*40})).length,2);
});

const layoutMap = { minX: 0, maxX: 1000, minY: 0, maxY: 1000 };
const members = clusters => clusters.map(c => c.items.map(p => p.key));

function assertRefinement(coarse, fine) {
  const parents = new Map(coarse.flatMap(cluster => cluster.items.map(point => [point.key, cluster])));
  for (const cluster of fine) {
    const parent = parents.get(cluster.items[0].key);
    assert.ok(parent);
    assert.ok(cluster.items.every(point => parents.get(point.key) === parent), 'Zooming in must only split existing groups');
  }
}

test('chains join through any member regardless of input order or total spread', () => {
  const points = [0, 5, 10, 15, 100].map((x, i) => ({ key: String(i), x, y: 0 }));
  for (const order of [points, [...points].reverse(), [points[0], points[3], points[4], points[1], points[2]]]) {
    const groups = clusterMarkers(order, point => point);
    assert.deepEqual(groups.map(c => c.items.map(p => p.key).sort()).sort(), [['0', '1', '2', '3'], ['4']]);
  }
});

test('a late connecting icon merges two existing groups', () => {
  const points = [0, 2, 12, 14, 7].map((x, i) => ({ key: String(i), x, y: 0 }));
  assert.equal(clusterMarkers(points.slice(0, 4), point => point).length, 2);
  assert.equal(clusterMarkers(points, point => point).length, 1);
});

test('close icons combine across former spatial split boundaries', () => {
  const points = [-15, -10, -5, 0, .5, 5.5, 10.5, 15.5].map((x, i) => ({ key: String(i), x, y: 0 }));
  assert.equal(layoutMapMarkers(points, layoutMap, 1000, new Set()).length, 1);
});

test('dense overlapping icons connect into a single bubble', () => {
  const points = Array.from({ length: 256 }, (_, i) => ({ key: String(i), x: (i % 16) * 3, y: Math.floor(i / 16) * 3 }));
  const layout = layoutMapMarkers(points, layoutMap, 1000, new Set());
  assert.equal(layout.length, 1);
  assert.equal(layout[0].items.length, points.length);
});

test('pairs only bubble when heavily overlapping and trip stops remain individual', () => {
  const points = [0, 5].map((x, i) => ({ key: String(i), x, y: 0 }));
  assert.deepEqual(members(layoutMapMarkers(points, layoutMap, 1000, new Set())), [['0', '1']]);
  assert.deepEqual(members(layoutMapMarkers(points, layoutMap, 2000, new Set())), [['0'], ['1']]);
  assert.deepEqual(members(layoutMapMarkers(points, layoutMap, 1000, new Set(['1']))), [['0'], ['1']]);
  assert.equal(clusterMarkers([{x:0,y:0}, {x:6,y:6}], p => p).length, 2, 'Use actual distance, not just neighboring grid cells');
});

test('coincident objectives stay in one bubble at every zoom', () => {
  const points = [-3, -2, -1, 0, 0, 0, 0, 0, 1, 2, 3].map((x, i) => ({ key: String(i), x: 500 + x, y: 500 }));
  for (const stops of [new Set(), new Set(['3'])]) for (const size of [1000, 16000, 128000, 16000, 1000]) {
    const layout = layoutMapMarkers(points, layoutMap, size, stops);
    const bubbles = layout.filter(c => c.items.length > 1 && c.items.some(p => p.x === 500));
    assert.equal(bubbles.length, 1);
    assert.equal(bubbles[0].items.filter(p => p.x === 500).length, 5 - stops.size);
    if (size >= 16000) assert.equal(bubbles[0].items.length, 5 - stops.size);
    if (stops.size) assert.equal(layout.find(c => c.items.some(p => p.key === '3')).items.length, 1);
  }
});

test('zooming splits connections consistently and preserves every objective', () => {
  let seed = 2718;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const points = Array.from({ length: 1500 }, (_, i) => ({
    key: String(i), x: i < 8 ? 500 : random() * 1100 - 50, y: i < 8 ? 500 : random() * 1100 - 50,
  }));
  const stops = new Set(['0', '100']);
  const sizes = [80, 200, 400, 500, 625, 1000, 4000, 32000, 128000];
  const layouts = sizes.map(size => layoutMapMarkers(points, layoutMap, size, stops));
  layouts.forEach((layout, index) => {
    assert.equal(new Set(layout.flatMap(c => c.items.map(p => p.key))).size, points.length);
    assert.equal(layout.reduce((sum, c) => sum + c.items.length, 0), points.length);
    for (const cluster of layout) {
      if (cluster.items.some(p => stops.has(p.key))) assert.equal(cluster.items.length, 1);
      const positions = cluster.items.map(p => project(p, layoutMap));
      assert.ok(Math.abs(cluster.x - positions.reduce((sum,p) => sum + p.x,0) / positions.length * sizes[index]) < 1e-8);
      assert.ok(Math.abs(cluster.y - positions.reduce((sum,p) => sum + p.y,0) / positions.length * sizes[index]) < 1e-8);
    }
    if (index) assertRefinement(layouts[index - 1], layout);
  });
  for (let i = sizes.length - 1; i >= 0; i--) {
    assert.deepEqual(members(layoutMapMarkers(points, layoutMap, sizes[i], stops)), members(layouts[i]));
  }
});

test('panning across grid boundaries moves bubbles without changing anchors or membership', () => {
  const points = mapObjectives([category('notes', [
    item('a', '120, 900'), item('b', '121, 900'), item('c', '123, 900'),
    item('d', '120, 898'), item('e', '126, 894'), item('f', '123, 897'),
  ])]);
  const layout = layoutMapMarkers(points, layoutMap, 1000, new Set());
  assert(layout.some(c => c.items.length > 1));
  for (const offset of [{x:0,y:0}, {x:13,y:17}, {x:-45,y:-35}, {x:100.25,y:80.5}, {x:0,y:0}]) {
    const visible = visibleMarkerClusters(layout, offset, 1000, 1000);
    assert.deepEqual(members(visible), members(layout));
    visible.forEach((cluster, i) => {
      assert.equal(cluster.x, layout[i].x + offset.x);
      assert.equal(cluster.y, layout[i].y + offset.y);
      assert.strictEqual(cluster.items, layout[i].items);
    });
  }
});

test('viewport clipping hides whole bubbles without regrouping their offscreen members', () => {
  const points = mapObjectives([category('notes', [item('a', '30, 900'), item('b', '32, 900'), item('c', '33.5, 900'), item('d', '35, 900'), item('e', '120, 900')])]);
  const layout = layoutMapMarkers(points, layoutMap, 1000, new Set());
  assert.deepEqual(members(layout), [['notes:a', 'notes:b', 'notes:c', 'notes:d'], ['notes:e']]);
  assert.deepEqual(members(visibleMarkerClusters(layout, {x:-50,y:0}, 100, 200)), members(layout));
  assert.deepEqual(members(visibleMarkerClusters(layout, {x:-80,y:0}, 100, 200)), [['notes:e']]);
  assert.deepEqual(members(visibleMarkerClusters(layout, {x:100,y:0}, 100, 200)), []);
  assert.deepEqual(members(visibleMarkerClusters(layout, {x:0,y:0}, 100, 200)), members(layout));
});

test('map layouts still respond to zoom, filters and individually numbered trip stops', () => {
  const points = mapObjectives([category('notes', [item('a', '30, 900'), item('b', '32, 900'), item('c', '33.5, 900'), item('d', '35, 900'), item('e', '120, 900')])]);
  const layout = (points, size = 1000, stops = new Set()) => layoutMapMarkers(points, layoutMap, size, stops);
  assert.deepEqual(members(layout(points, 6000)), [['notes:a'], ['notes:b'], ['notes:c'], ['notes:d'], ['notes:e']]);
  assert.deepEqual(members(layout(points.slice(1))), [['notes:b', 'notes:c', 'notes:d'], ['notes:e']]);
  assert.deepEqual(members(layout(points, 1000, new Set(['notes:b']))), [['notes:a', 'notes:c', 'notes:d'], ['notes:e'], ['notes:b']]);
  assert.deepEqual(members(layout(points)), [['notes:a', 'notes:b', 'notes:c', 'notes:d'], ['notes:e']]);
  assert.deepEqual(layout([]), []);
});
