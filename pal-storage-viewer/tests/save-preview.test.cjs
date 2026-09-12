const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText, filename);
const { previewSave } = require('../src/backend/save-preview.ts');
const { pendingFileDetails } = require('../src/app/pending-file-details.ts');
const parsed = (kind, payload) => ({ kind, payload, class_name: '', saved_at: '' });
const uid = '00000000000000000000000000000001';
const level = name => previewSave(parsed('level', {
  records: [{ largePalRecord: true }], players: [{ player_uid: uid, name }], bases: [{}], labs: [{ research: 100 }],
}));
const completion = Object.fromEntries([
  ...'tower_bosses bosses paldeck notes item_pickups fast_travel areas area_barriers world_maps npc_achievements pal_display quests_completed quests_active skins technologies'.split(' ').map(key => [key, []]),
  ...'tower_boss_counts raid_boss_counts capture_counts capture_bonus_counts relics relics_unspent rankup_counts counters'.split(' ').map(key => [key, {}]),
]);
completion.paldeck = ['a'];
const player = previewSave(parsed('player', { player_uid: uid, completion }));
const catalog = {
  relicTypes: [], relics: {}, fastTravel: {}, notes: {}, quests: {}, bosses: [], towers: {}, areas: {}, ruinPickups: {},
  paldeck: [['a', 1, 'A'], ['b', 2, 'B']], technologies: [], raids: [], statueRanks: {},
  research: [['research', 'Research', 'Test', 100]], skins: [], maxLevel: 65, palCritics: [],
};

test('preview retains counts and metadata without transferring Pal records', () => {
  const world = level('Church');
  assert.equal(world.pals, 1);
  assert.equal(world.bases, 1);
  assert.deepEqual(world.players, [{ uid, name: 'Church' }]);
  assert.equal('records' in world, false);
  assert.deepEqual(previewSave(parsed('dimensional_storage', { records: [], occupied_slots: 1935 })), { kind: 'dimensional_storage', pals: 1935 });
  const meta = previewSave(parsed('level_meta', { world_name: 'All Blue', in_game_day: 0 }));
  assert.deepEqual(pendingFileDetails([meta], null)[0], { text: 'All Blue', stat: 'day 0' });
});

test('names resolve regardless of arrival order and refresh when Level is added or removed', () => {
  assert.equal(pendingFileDetails([player], null)[0].text, '');
  assert.equal(pendingFileDetails([player, level('Church')], null)[0].text, 'Church');
  assert.equal(pendingFileDetails([level('Diavolo'), player], null)[1].text, 'Diavolo');
  assert.equal(pendingFileDetails([player, undefined], null)[0].text, '');
});

test('progress uses tracker category weighting and the matching world research', () => {
  // Paldeck 50%, capture bonus 0%, research 100%, achievements 0% => 37.5% overall.
  assert.deepEqual(pendingFileDetails([player, level('Church')], catalog)[0], { text: 'Church', stat: '37.5%', statTitle: 'Tracker progress' });
  // Without research data that category is excluded, giving (50 + 0 + 0) / 3.
  assert.equal(pendingFileDetails([player], catalog)[0].stat, '16.7%');
  assert.equal(pendingFileDetails([player], null, undefined, true)[0].stat, '...');
  const noRecord = { ...player, completion: null };
  assert.equal(pendingFileDetails([noRecord], catalog)[0].text, '');
  assert.equal(pendingFileDetails([noRecord], catalog)[0].stat, '-');
  assert.equal(pendingFileDetails([noRecord], catalog)[0].statTitle, 'Progress unavailable');
});

test('append previews can resolve players and progress from the already loaded world', () => {
  const loaded = { players: [{ uid, name: 'Existing player' }], labs: [{ research: 100 }] };
  assert.equal(pendingFileDetails([player], catalog, loaded)[0].stat, '37.5%');
});

test('empty worlds and failed reads remain distinct from missing progress', () => {
  const empty = previewSave(parsed('level', { records: [], players: [], bases: [], labs: [] }));
  assert.equal(empty.pals, 0);
  assert.equal(pendingFileDetails([empty], null)[0].text, '0 players · 0 bases');
  const broken = previewSave({ error: 'Truncated save' });
  assert.equal(broken.pals, null);
  assert.equal(pendingFileDetails([broken], null)[0].text, 'Could not read file: Truncated save');
});
