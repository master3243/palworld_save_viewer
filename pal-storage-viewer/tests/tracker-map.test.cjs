const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText, filename);
const { worldToMap, mapOf } = require('../src/app/completion/completion-model.ts');
const { mapObjectives, project, unproject, clusterMarkers, nearestTravel, parseCoordinates } = require('../src/app/completion/tracker-map-model.ts');
const maps = require('../../resources/completion/maps/maps.json');
const item = (id, coords, extra={}) => ({id, name:id, coords, map:'', state:'todo', detail:'', group:'', order:0, no:null, ...extra});
const category = (key, items, extra={}) => ({key, title:key, items, ...extra});

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
  const points = mapObjectives([category('notes',[item('a','47, 20'),item('b','49, 20'),item('c','49, 20'),item('d','180, 20')])]);
  const clusters = clusterMarkers(points,p=>p);
  assert.equal(clusters.length,2);
  assert.deepEqual(clusters.flatMap(c=>c.items.map(p=>p.item.id)).sort(),['a','b','c','d']);
  assert.equal(clusterMarkers(points,p=>({x:p.x*30,y:p.y*30})).length,3);
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
