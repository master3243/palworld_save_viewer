const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { summarize } = require('../src/app/completion/completion-model.ts');
const data = require('../../resources/completion/completion-data.json');

function record(extra = {}) {
  return {
    ...Object.fromEntries(['tower_bosses', 'bosses', 'paldeck', 'notes', 'item_pickups', 'fast_travel', 'areas',
      'area_barriers', 'world_maps', 'npc_achievements', 'pal_display', 'quests_completed', 'quests_active',
      'skins', 'technologies'].map(key => [key, []])),
    ...Object.fromEntries(['tower_boss_counts', 'raid_boss_counts', 'capture_counts', 'capture_bonus_counts',
      'relics', 'relics_unspent', 'rankup_counts', 'counters'].map(key => [key, {}])),
    ...extra,
  };
}
const category = (key, extra) => summarize(record(extra), data).categories.find(c => c.key === key);
const mission = (id, extra) => category('sideQuests', extra).items.find(i => i.id === id);
const flags = (prefix, count) => Array.from({ length: count }, (_, i) => `${prefix}_${i + 1}`);

test('side missions have distinct start locations without changing completion', () => {
  const c = category('sideQuests', { quests_completed: ['Sub_Zoe03'] });
  assert.equal(c.total, 58);
  assert.equal(c.done, 1);
  assert.equal(c.items.filter(i => i.coords).length, 58);
  const critics = c.items.filter(i => /^Sub_PalDisplay_[A-I]_01$/.test(i.id));
  assert.equal(critics.length, 9);
  assert.equal(new Set(critics.map(i => i.coords)).size, 9);
  assert.ok(critics.every(i => !i.detail.includes('critics at')));
  assert.equal(c.items.find(i => i.id === 'Sub_Zoe03').coords, '65, -411');
  assert.equal(c.items.find(i => i.id === 'Sub_RookieExpeditionTeam02').coords, '-665, -743');
  assert.equal(c.items.find(i => i.id === 'Sub_LoneWolf03').coords, '-1034, -938');
  assert.equal(c.items.find(i => i.id === 'Sub_LoneWolf02').coords, '-628, 230');
  const { mapObjectives } = require('../src/app/completion/tracker-map-model.ts');
  const points = mapObjectives([c]);
  assert.equal(points.filter(p => p.map === 'palpagos').length, 57);
  assert.equal(points.filter(p => p.map === 'tree').length, 1);
  const guardian = c.items.find(i => i.id === 'Sub_HowSurviveWorldTree');
  assert.equal(guardian.map, 'World Tree');
  assert.equal(guardian.coords, '102, 773');
});

test('technology FName aliases count once and only genuinely unknown IDs are reported', () => {
  const c = category('technologies', { technologies: ['PalBox', 'PALBOX', 'ShotgunBullet', 'OverHeatRifle',
    'SkillUnlock_Sakurasaurus_Water', 'UnknownTechnology'] });
  assert.equal(c.done, 4);
  assert.equal(c.total, 588);
  assert.deepEqual(c.unknown, ['UnknownTechnology']);
  for (const id of ['PALBOX', 'ShotGunBullet', 'OverheatRifle', 'SkillUnlock_SakuraSaurus_Water']) {
    assert.equal(c.items.find(i => i.id === id).state, 'done');
  }
});

const pointData = { ...data, technologies: [
  ['Free', 'Free recipe', 1, 0, 0],
  ['Known', 'Known recipe', 2, 0, 3],
  ['Regular', 'Regular recipe', 3, 0, 5],
  ['Later', 'Later recipe', 70, 0, 4],
  ['AncientKnown', 'Known ancient recipe', 10, 1, 2],
  ['Ancient', 'Ancient recipe', 20, 1, 7],
] };
const pointsCategory = extra => summarize(record(extra), pointData).categories.find(c => c.key === 'technologies');

test('remaining technology costs exclude unlocked aliases and subtract each point balance separately', () => {
  const c = pointsCategory({ technologies: ['KNOWN', 'known', 'ancientknown', 'Unknown'],
    counters: { technology_points: 2, boss_technology_points: 10 } });
  assert.deepEqual(c.technologyPoints, [
    { key: 'regular', name: 'Technology points', remaining: 9, available: 2, needed: 7 },
    { key: 'ancient', name: 'Ancient technology points', remaining: 7, available: 10, needed: 0 },
  ]);
  assert.equal(c.items.find(i => i.id === 'Free').detail, '0 technology points');
  assert.equal(c.items.find(i => i.id === 'Ancient').detail, '7 ancient technology points');
  assert.deepEqual(c.unknown, ['Unknown']);
});

test('unavailable point balances stay unknown; zero balances and completed technology trees need no guesswork', () => {
  const missing = pointsCategory({ counters: { technology_points: null } });
  assert.deepEqual(missing.technologyPoints.map(p => [p.remaining, p.available, p.needed]),
    [[12, null, null], [9, null, null]]);
  const zero = pointsCategory({ counters: { technology_points: 0, boss_technology_points: 0 } });
  assert.deepEqual(zero.technologyPoints.map(p => p.needed), [12, 9]);
  const complete = pointsCategory({ technologies: pointData.technologies.map(([id]) => id) });
  assert.deepEqual(complete.technologyPoints.map(p => [p.remaining, p.needed]), [[0, 0], [0, 0]]);
});

test('every bundled technology retains its source point cost', () => {
  const source = require('../../completion_sources/raw/psp/technologies.json');
  for (const [id, , , , cost] of data.technologies) {
    assert.equal(cost, source[id].cost, id);
    assert.ok(Number.isInteger(cost) && cost >= 0, id);
  }
});

test('legacy tutorial flags do not inflate story completion or become unknown IDs', () => {
  const c = category('mainQuests', { quests_completed: ['Main_PickupWood', 'Main_BuildWorkBench_Old',
    'Main_CaptureSheepBall_Old', 'main_buildworkbench'] });
  assert.equal(c.total, 32);
  assert.equal(c.done, 1);
  assert.deepEqual(c.unknown, []);
  assert.ok(!c.items.some(i => i.id === 'Main_PickupWood'));
  assert.equal(c.items.find(i => i.id === 'Main_DefeatWorldTreeMiddleBoss').state, 'todo');
});

test('finishing the dragon does not invent a Path to the Abyss completion flag', () => {
  const current = category('mainQuests', {}).items.map(i => i.id);
  const completed = current.filter(id => id !== 'Main_DefeatWorldTreeMiddleBoss');
  const c = category('mainQuests', { quests_completed: completed });
  assert.equal(c.done, 31);
  assert.equal(c.total, 32);
  assert.equal(c.percent, 96.9);
  assert.equal(category('mainQuests', { quests_completed: current }).done, 32);
});

test('finite NPC rewards require all stages, rather than a completed request introduction', () => {
  for (const [id, prefix, count] of [['Sub_BossDefeatReward', 'BossDefeat', 6],
    ['Sub_PalCaptureCountReward', 'PalCapture', 10], ['Sub_PaldexReward', 'PalDex', 10]]) {
    const full = flags(prefix, count);
    const partial = mission(id, { npc_achievements: full.slice(0, -1), quests_completed: [id] });
    assert.equal(partial.state, 'active');
    assert.equal(partial.detail, `${count - 1} / ${count} rewards claimed`);
    assert.equal(mission(id, { npc_achievements: full }).state, 'done');
    assert.equal(mission(id, { quests_completed: [id] }).state, 'active');
    assert.equal(mission(id, {}).state, 'todo');
  }
});

test('duplicate, unrelated and out-of-range reward flags cannot fill missing stages', () => {
  const claimed = ['BossDefeat_1', 'bossdefeat_1', 'BossDefeat_3', 'BossDefeat_4', 'BossDefeat_5',
    'BossDefeat_6', 'BossDefeat_7', 'PalDex_2'];
  const item = mission('Sub_BossDefeatReward', { npc_achievements: claimed });
  assert.equal(item.state, 'active');
  assert.equal(item.detail, '5 / 6 rewards claimed');
});

test('each Pal Critic uses its own six stages and the correct save field', () => {
  const extra = { pal_display: [...flags('Area_A1', 6), 'area_b1_1', ...flags('Area_I1', 6)],
    npc_achievements: flags('Area_C1', 6) };
  for (const area of ['A', 'I']) {
    const item = mission(`Sub_PalDisplay_${area}_01`, extra);
    assert.equal(item.state, 'done');
    assert.equal(item.detail, '6 / 6 rewards claimed');
  }
  assert.equal(mission('Sub_PalDisplay_B_01', extra).state, 'active');
  assert.equal(mission('Sub_PalDisplay_B_01', extra).detail, '1 / 6 rewards claimed');
  assert.equal(mission('Sub_PalDisplay_C_01', extra).state, 'todo');
});

test('ordinary and repeatable missions retain explicit completion and active counters', () => {
  const extra = { quests_completed: ['sub_farmer01'], quests_active: [{ id: 'Sub_FoodReward', block: 1,
    counters: { QuestBlock_DeliveryItem_TotalDeliveredCount: 3 } }], npc_achievements: flags('PalDex', 10) };
  assert.equal(mission('Sub_Farmer01', extra).state, 'done');
  const foodie = mission('Sub_FoodReward', extra);
  assert.equal(foodie.state, 'active');
  assert.match(foodie.detail, /total delivered count 3/);
  assert.equal(mission('Sub_FoodReward', { quests_completed: ['Sub_FoodReward'] }).state, 'done');
});
