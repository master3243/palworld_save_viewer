const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText, filename);
const { Lookups } = require('../src/backend/lookups.ts');
const { deriveStats } = require('../src/backend/stats.ts');
const { FieldLookup, buildFieldRegistry } = require('../src/app/filter/filter-model.ts');
const { FilterEngine } = require('../src/app/filter/filter-engine.ts');
const { parseQuery } = require('../src/app/filter/filter-query.ts');

const resource = name => fs.readFileSync(path.join(__dirname, '../../resources', name + '_lookup.json'), 'utf8');
const lookups = new Lookups({ palTraitsJson: resource('pal_traits'), skillDetailsJson: resource('skill_details') });
const defaults = {
  level: 1, exp: null, rank: 1,
  soul_ranks: { hp: null, attack: null, defense: null, craft_speed: null },
  passive_skill_ids: [], active_skill_ids: [], mastered_skill_ids: [],
  friendship_points: null, food_item: null, food_seconds_left: null,
};
// In-game screenshots supplied September 8, 2026. Lucky Pals use the BOSS species scaling.
const examples = [
  { name: 'Palumba', input: { ...defaults, species_id: 'TropicalOstrich', ivs: { hp: 17, attack: 5, defense: 71 }, passive_skill_ids: ['PAL_Sanity_Down_2'] }, expected: [560, 108, 60, 280] },
  { name: 'Arsox', input: { ...defaults, species_id: 'FlameBuffalo', ivs: { hp: 83, attack: 69, defense: 21 } }, expected: [558, 108, 57, 276] },
  { name: 'Eikthyrdeer', input: { ...defaults, species_id: 'BOSS_Deer', level: 16, rank: 2, ivs: { hp: 87, attack: 92, defense: 84 }, passive_skill_ids: ['Rare', 'Deffence_down2'] }, expected: [1816, 268, 169, 3096] },
];
for (const { name, input, expected } of examples) {
  test(`${name}: derived stats and expedition firepower match the in-game screenshot`, () => {
    const s = deriveStats(input, lookups);
    assert.deepEqual([s.max_hp, s.attack, s.defense, s.firepower], expected);
  });
}

test('firepower ignores passive and food bonuses and equipped moves', () => {
  const input = examples[2].input;
  const plain = deriveStats({ ...input, passive_skill_ids: [] }, lookups);
  const foodLookups = new Lookups({ palTraitsJson: resource('pal_traits'), skillDetailsJson: resource('skill_details') });
  foodLookups.foodBuffs.set('test_food', { name: 'Test food', effects: [['Attack', 20], ['Defense', 20]] });
  const buffed = deriveStats({ ...input, food_item: 'test_food', food_seconds_left: 60, active_skill_ids: ['PowerBomb'] }, foodLookups);
  assert.notEqual(buffed.attack, plain.attack);
  assert.notEqual(buffed.defense, plain.defense);
  assert.equal(plain.firepower, 3096);
  assert.equal(buffed.firepower, 3096);
});

test('missing rank and level use fresh Pal defaults; unknown stats stay unavailable', () => {
  assert.equal(deriveStats({ ...examples[0].input, level: null, rank: null }, lookups).firepower, 280);
  assert.equal(deriveStats({ ...examples[0].input, species_id: 'UnknownSpecies' }, lookups).firepower, null);
});

test('all condensation ranks multiply after flooring the HP contribution', () => {
  const input = examples[1].input;
  // Same Arsox at 0–4 stars, including the base stat increases from condensation.
  assert.deepEqual([1, 2, 3, 4, 5].map(rank => deriveStats({ ...input, rank }, lookups).firepower), [276, 1156, 2718, 5072, 8250]);
});

test('firepower is a numeric filter and sorts descending with missing values last', () => {
  const rows = examples.map(({ name, input }) => ({ pal_name: name, firepower: deriveStats(input, lookups).firepower }));
  rows.push({ pal_name: 'Unknown', firepower: null });
  const fields = new FieldLookup(buildFieldRegistry(rows));
  const engine = new FilterEngine(fields, rows);
  const run = query => {
    const parsed = parseQuery(query, fields);
    assert.deepEqual(parsed.errors, []);
    assert.deepEqual(engine.errors(parsed.root), []);
    return engine.sort(engine.filter(parsed.root), parsed.sorts).map(row => row.pal_name);
  };
  assert.deepEqual(run('firepower>=280 sort:-firepower'), ['Eikthyrdeer', 'Palumba']);
  assert.deepEqual(run('expedition_power:276..280'), ['Palumba', 'Arsox']);
  assert.deepEqual(run('sort:-expedition_firepower'), ['Eikthyrdeer', 'Palumba', 'Arsox', 'Unknown']);
});
