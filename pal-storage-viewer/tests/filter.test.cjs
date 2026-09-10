const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
// Run the pure TypeScript query/engine modules with the project's existing compiler.
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText, filename);
const { FieldLookup, buildFieldRegistry, createGroup, createRule } = require('../src/app/filter/filter-model.ts');
const { FilterEngine } = require('../src/app/filter/filter-engine.ts');
const { parseQuery, serializeQuery } = require('../src/app/filter/filter-query.ts');
const { MoveCatalog } = require('../src/app/filter/move-filters.ts');
const detail = (element, power, cooldown = 10, effects = []) => ({element, power, cooldown, effects, melee: false});
const catalog = new MoveCatalog(id => ({dark: detail(5, 30), fire: detail(1, 150, 20, [['Burn', 100]]), strongdark: detail(5, 150), ice: detail(8, 200)})[id] ?? null);
const rows = [
 {pal_name:'A', hp:20, max_hp:100, iv_hp:95, iv_attack:90, iv_defense:80, level:10, paldeck_no:'12B', active_skill_ids:'dark;fire', combat_moves:'Dark Ball;Fire Ball', known_skill_ids:'dark;fire;ice', known_moves:'Dark Ball;Fire Ball;Ice Ball', unlearned_moves:'[{"id":"strongdark","name":"Strong Dark","level":50}]'},
 {pal_name:'B', hp:70, max_hp:100, iv_hp:20, iv_attack:50, iv_defense:50, level:10, paldeck_no:'12', active_skill_ids:'strongdark', combat_moves:'Strong Dark'},
 {pal_name:'C', hp:100, max_hp:100, iv_hp:100, level:20, paldeck_no:'13'},
 {pal_name:'D', hp:0, max_hp:0, level:null, paldeck_no:'12B'},
 {pal_name:'E', hp:null, max_hp:100, level:5, paldeck_no:null},
];
const lookup = new FieldLookup(buildFieldRegistry(rows, catalog));
const engine = new FilterEngine(lookup, rows, catalog);
function run(query) { const parsed = parseQuery(query, lookup); assert.deepEqual(parsed.errors, [], query); assert.deepEqual(engine.errors(parsed.root), [], query); return engine.sort(engine.filter(parsed.root), parsed.sorts).map(row => row.pal_name); }
function roundTrip(query) { const parsed = parseQuery(query, lookup); const serialized = serializeQuery(parsed.root, lookup, parsed.sorts); assert.deepEqual(run(serialized), run(query), serialized); }

test('numeric comparisons use current health and preserve IV hp alias', () => {
 assert.deepEqual(run('current_hp<max_hp'), ['A','B']);
 assert.deepEqual(run('current_hp < max_hp / 2'), ['A']);
 assert.deepEqual(run('hp_pct<50'), ['A']);
 assert.deepEqual(run('hp>=90'), ['A','C']);
 assert.deepEqual(run('missing_hp>0'), ['A','B']);
});
test('arithmetic precedence, parentheses, unary values and scientific notation', () => {
 assert.deepEqual(run('current_hp < (max_hp - 20) / 2'), ['A']);
 assert.deepEqual(run('current_hp<"max_hp / 2"'), ['A']);
 assert.deepEqual(run('level>=1e1'), ['A','B','C']);
 assert.deepEqual(run('current_hp<max_hp/2 -is:alpha'), ['A']);
});
test('missing values and runtime division by zero never compare equal or unequal', () => {
 assert.deepEqual(run('current_hp!=max_hp/0'), []);
 assert(!run('hp_pct!=50').includes('D'));
 assert(!run('current_hp<max_hp').includes('E'));
});
test('ranges and negative numbers remain compatible', () => {
 assert.deepEqual(run('level:5..10'), ['A','B','E']);
 assert.deepEqual(run('level:..10'), ['A','B','E']);
 assert.deepEqual(run('level:10..'), ['A','B','C']);
 assert.deepEqual(run('level>=-1'), ['A','B','C','E']);
});
test('move element filters distinguish equipped, known and locked', () => {
 assert.deepEqual(run('equipped_type:Dark'), ['A','B']);
 assert.deepEqual(run('known_type:Ice'), ['A']);
 assert.deepEqual(run('equipped_type:Ice'), []);
 assert.deepEqual(run('unlearned_type:Dark'), ['A']);
 assert.deepEqual(run('known:Strong'), ['B']);
});
test('move groups correlate all properties on the same move', () => {
 assert.deepEqual(run('equipped_move:(type:Dark power>=100)'), ['B']);
 assert.deepEqual(run('known_move:(type:Ice power>=100 cooldown<=10)'), ['A']);
 assert.deepEqual(run('unlearned_move:(type:Dark level<=50)'), ['A']);
 assert.deepEqual(run('known_move:(effect:Burn)'), ['A']);
});
test('none/every quantifiers handle empty collections explicitly', () => {
 assert.deepEqual(run('equipped_move!=(type:Dark)'), ['C','D','E']);
 assert.deepEqual(run('equipped_move=(type:Dark)'), ['B']);
 assert.deepEqual(run('-equipped_move:(type:Dark)'), ['C','D','E']);
});
test('multi sort has explicit priority, natural numbers and missing-last both ways', () => {
 assert.deepEqual(run('sort:-level,pal'), ['C','A','B','E','D']);
 assert.deepEqual(run('sort:level,-pal'), ['E','B','A','C','D']);
 assert.deepEqual(run('sort:no,pal'), ['B','A','D','C','E']);
 assert.deepEqual(run('sort:-no,pal'), ['C','A','D','B','E']);
 assert.deepEqual(run('level>=10 sort:-level,-iv'), ['C','A','B']);
});
test('builder/query/preset round trips retain meaning', () => {
 for (const query of ['current_hp<max_hp/2', 'current_hp < (max_hp-20)/2', 'hp_pct:10..80', 'equipped_move:(type:Dark power>=100)', 'known_move!=(effect:Burn)', 'equipped_move=(type:Dark)', '(pal:A OR pal:B) -is:lucky sort:-level,-iv', 'pal="A|B"', '-(pal:A OR pal:B)', 'sort:-hp_pct,pal']) roundTrip(query);
});
test('unfinished rules do not change OR or NOT groups', () => {
 const empty = createRule('level','gt',[]);
 assert.deepEqual(engine.filter(createGroup('or',[createRule('pal','is',['A']),empty])).map(row=>row.pal_name),['A']);
 assert.deepEqual(engine.filter(createGroup('and',[empty],true)),rows);
});
test('invalid expressions and malformed queries are diagnosed', () => {
 for(const query of ['current_hp<does_not_exist','current_hp<pal','current_hp<1/0','current_hp<alert(1)','current_hp<max_hp/','pal:"A','(pal:A','pal:A)','is:alpha AND','sort:missing','sort:level,-level','alpha:banana']) assert(parseQuery(query,lookup).errors.length, query);
});

test('move logic survives nested NOT and empty unfinished scopes', () => {
 roundTrip('equipped_move:(-(type:Dark OR power<100))');
 const group = createGroup('and', [createRule('move_element', 'has_any')]); group.scope='equipped';
 assert.deepEqual(engine.filter(group),rows);
});
test('incomplete binary operators and excessive nesting produce errors', () => {
 for(const query of ['(pal:A OR)', '(pal:A AND)', 'OR pal:A', 'AND pal:A', 'pal:A AND OR pal:B', 'level>1,2', '('.repeat(21)+'pal:A'+')'.repeat(21)]) assert(parseQuery(query,lookup).errors.length,query);
});

test('move suggestions count each Pal once across equipped and known moves', () => {
 const dark = engine.suggestions(engine.moveLookup.resolve('type')).find(item => item.value === 'Dark');
 assert.equal(dark.count, 2);
});

test('header clicks promote sorts without losing secondary priorities', () => {
 const { cycleSort } = require('../src/app/filter/filter-model.ts');
 const original = [{field:'level',direction:'asc'},{field:'iv',direction:'desc'},{field:'pal',direction:'asc'}];
 const promoted = cycleSort(original,'iv');
 assert.deepEqual(promoted,[original[1],original[0],original[2]]);
 assert.deepEqual(cycleSort(promoted,'iv'),[original[0],original[2]]);
 assert.deepEqual(cycleSort(original,'hp_pct'),[{field:'hp_pct',direction:'asc'},...original]);
 assert.equal(original[0].direction,'asc');
 assert.deepEqual(cycleSort(cycleSort(original,'level'),'level'),original.slice(1));
});
test('Shift-click cycles a secondary sort in place', () => {
 const { cycleSort } = require('../src/app/filter/filter-model.ts');
 const original=[{field:'level',direction:'asc'},{field:'iv',direction:'asc'}];
 assert.deepEqual(cycleSort(original,'iv',true),[original[0],{field:'iv',direction:'desc'}]);
 assert.deepEqual(cycleSort(original,'pal',true),[...original,{field:'pal',direction:'asc'}]);
});
test('percentage fields and percentages of absolute fields compare their literal values', () => {
 const sample={full_stomach:244,hunger_max:480};
 const fields=new FieldLookup(buildFieldRegistry([sample]));
 const filter=new FilterEngine(fields,[sample]);
 assert.equal(filter.filter(parseQuery('stomach_pct<hunger_max*0.11',fields).root).length,1);
 assert.equal(filter.filter(parseQuery('stomach_pct<11',fields).root).length,0);
 assert.equal(filter.filter(parseQuery('stomach<hunger_max*0.11',fields).root).length,0);
});

const { hasMultipleOwners } = require('../src/app/pal-owners.ts');
test('Owner is needed only when a single save has multiple owners', () => {
  const row = (save, uid, name) => ({save_id:save, owner_player_uid:uid, owner_name:name});
  assert.equal(hasMultipleOwners([row('A','1','Alex'), row('B','2','Bob')]),false);
  assert.equal(hasMultipleOwners([row('A','1','Alex'), row('A','2','Alex')]),true);
  assert.equal(hasMultipleOwners([row('A','1','Alex'), row('A','1','Alex'), row('A',null,'')]),false);
  assert.equal(hasMultipleOwners([row('A','1','Alex'), row('A','00000000-0000-0000-0000-000000000000','')]),false);
});

test('free text matches partner skill names and descriptions, including partial phrases', () => {
  const pals = [
    {pal_name:'Smith', partner_skill:'Cast Iron', partner_skill_text:'Increases productivity while working at a base.'},
    {pal_name:'Flyer', partner_skill:'Sky Rider', partner_skill_text:'Can be ridden as a flying mount.'},
    {pal_name:'Other', partner_skill:null, partner_skill_text:null},
    {pal_name:'Legacy'},
  ];
  const fields = new FieldLookup(buildFieldRegistry(pals));
  const search = new FilterEngine(fields, pals);
  const matches = query => {
    const parsed = parseQuery(query, fields);
    assert.deepEqual(parsed.errors, []);
    return search.filter(parsed.root).map(row => row.pal_name);
  };
  assert.deepEqual(matches('cast iro'), ['Smith']);
  assert.deepEqual(matches('"cast iro"'), ['Smith']);
  assert.deepEqual(matches('flying mount'), ['Flyer']);
  assert.deepEqual(matches('"FLYING MOUNT"'), ['Flyer']);
  assert.deepEqual(matches('"working at a ba"'), ['Smith']);
  assert.deepEqual(matches('-"flying mount"'), ['Smith', 'Other', 'Legacy']);
  assert.deepEqual(matches('cast iro OR "flying mount"'), ['Smith', 'Flyer']);
});
