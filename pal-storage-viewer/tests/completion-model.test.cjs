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

test('crafting lists all available outputs regardless of player unlocks or crafting history', () => {
  const empty = category('crafting', { crafted_item_counts: {} });
  assert.equal(empty.total, 1273);
  assert.equal(empty.done, 0);
  assert.equal(empty.unavailable, undefined);
  assert.ok(empty.items.every(item => item.state === 'todo' && item.crafting.count === 0));
  assert.ok(empty.items.some(item => item.id === 'Launcher_Meteor_5'));
  assert.ok(!empty.items.some(item => item.id === 'Bow_Poison'));
  assert.equal(new Set(empty.items.map(item => item.id.toLowerCase())).size, empty.total);
  const unlocked = category('crafting', { crafted_item_counts: {}, technologies: data.technologies.map(([id]) => id) });
  assert.deepEqual(unlocked, empty);
});

test('crafting counts distinct outputs once, preserves rarity variants, and ignores unknown historical items', () => {
  const c = category('crafting', { crafted_item_counts: {
    Pal_crystal_S: 200, PAL_CRYSTAL_S: 200,
    AssaultRifle_Default1: 1, AssaultRifle_Default5: 3, RepairKit: 12,
  } });
  assert.equal(c.done, 3);
  assert.equal(c.total, 1273);
  const crystal = c.items.find(item => item.id === 'Pal_crystal_S');
  assert.equal(crystal.crafting.count, 200);
  assert.equal(crystal.crafting.recipes.length, 13);
  assert.deepEqual(c.unknown, ['repairkit']);
  for (const [id, rarity] of [['AssaultRifle_Default1', 0], ['AssaultRifle_Default5', 4]]) {
    const item = c.items.find(item => item.id === id);
    assert.equal(item.state, 'done');
    assert.equal(item.crafting.rarity, rarity);
  }
  assert.equal(c.groups.reduce((sum, group) => sum + group.done, 0), 3);
  assert.equal(c.groups.reduce((sum, group) => sum + group.total, 0), 1273);
  assert.ok(c.items.slice(0, -3).every(item => item.state === 'todo'));
});

test('crafting exposes recipe quantities, ingredients, and schematic sources', () => {
  const c = category('crafting', { crafted_item_counts: {} });
  const rifle = c.items.find(item => item.id === 'AssaultRifle_Default5');
  assert.ok(rifle.crafting.sources.some(source => source.includes('Schematic')));
  assert.equal(rifle.crafting.recipes[0].quantity, 1);
  assert.deepEqual(rifle.crafting.recipes[0].ingredients.map(([id, , count]) => [id, count]),
    [['IronIngot', 80], ['Polymer', 20], ['CarbonFiber', 20], ['PalCrystal_Ex', 4]]);
  assert.equal(c.items.find(item => item.id === 'HotMilk').crafting.recipes[0].id, 'Hotmilk');
});

test('missing crafting history stays unknown and does not lower overall completion', () => {
  for (const crafted_item_counts of [null, undefined]) {
    const r = record({ crafted_item_counts });
    const c = category('crafting', r);
    assert.equal(c.total, 1273);
    assert.ok(c.unavailable);
    assert.ok(c.items.every(item => item.crafting.count === null));
    assert.equal(summarize(r, data).percent, summarize(r, { ...data, crafting: [] }).percent);
  }
});

test('capture bonus shows fishing tiers for matching species without changing capture progress', () => {
  const progress = {
    capture_counts: { Penguin: 21, Penguin_Electric: 8 },
    capture_bonus_counts: { Penguin: 5, Penguin_Electric: 2 },
  };
  const before = category('captureBonus', progress);
  const after = category('captureBonus', {
    ...progress,
    fishing_counts: {
      FishShadow_Penguin_Common: 3, FISHSHADOW_PENGUIN_COMMON: 3,
      FishShadow_Penguin_Boss: 2, FishShadow_Penguin_Nushi: 1,
      FishShadow_Penguin_Electric_Common: 4,
      FishShadow_BlueDragon_Common: 0,
    },
  });
  assert.deepEqual(after.items.find(item => item.id === 'Penguin').fishing, { common: 3, whopper: 2, lunker: 1 });
  assert.deepEqual(after.items.find(item => item.id === 'Penguin_Electric').fishing, { common: 4, whopper: 0, lunker: 0 });
  assert.equal(after.items.filter(item => item.fishing).length, 2);
  assert.deepEqual(after.items.map(({ fishing, ...item }) => item), before.items.map(({ fishing, ...item }) => item));
  assert.equal(after.done, before.done);
  assert.equal(after.percent, before.percent);
});

test('missing fishing data stays hidden and unknown variants are not assigned to the wrong species', () => {
  for (const fishing_counts of [undefined, null, {}]) {
    assert.ok(category('captureBonus', { fishing_counts }).items.every(item => item.fishing === undefined));
  }
  const c = category('captureBonus', { fishing_counts: {
    FishShadow_IceSeal_Ground_Fire_Boss: 2, FishShadow_Unknown_Common: 1,
    FishShadow_Penguin_Common: -1, FishShadow_Penguin_Boss: NaN,
  } });
  assert.ok(c.items.every(item => item.fishing === undefined));
  assert.deepEqual(c.unknown, ['fishshadow_iceseal_ground_fire_boss', 'fishshadow_unknown_common']);
});

test('Pal Effigies includes each species capture reward in its total and Mimog group', () => {
  const c = category('relics', {});
  const rewards = c.items.filter(item => item.group === 'move_speed');
  assert.equal(c.total, 695);
  assert.equal(c.done, 0);
  assert.equal(rewards.length, 288);
  assert.equal(new Set(c.items.map(item => item.id)).size, c.total);
  assert.deepEqual(c.groups.find(group => group.key === 'move_speed'),
    { key: 'move_speed', name: 'Mimog Effigy', done: 0, total: 288 });
  for (const [tribe, , name] of data.paldeck) {
    const reward = rewards.find(item => item.id === `capture-bonus:${tribe}`);
    assert.equal(reward.name, 'Mimog Effigy');
    assert.equal(reward.detail, `Capture 5 ${name} · 0/5`);
    assert.equal(reward.state, 'todo');
    assert.equal(reward.coords, '');
    assert.notEqual(reward.counted, false);
  }
});

test('Mimog reward progress follows capture bonuses and stays complete after spending the effigy', () => {
  const [[first], [second], [third], [fourth]] = data.paldeck;
  const pickup = Object.keys(data.relics)[0];
  const c = category('relics', {
    capture_bonus_counts: { [first.toUpperCase()]: 5, [second.toLowerCase()]: 3, [third]: 8, UnknownSpecies: 5 },
    capture_counts: { [fourth]: 100 },
    relics_unspent: { MoveSpeed: 0 }, relics: { CapturePower: [pickup] },
  });
  assert.equal(c.total, 695);
  assert.equal(c.done, 3);
  assert.equal(c.groups.find(group => group.key === 'move_speed').done, 2);
  assert.equal(c.items.find(item => item.id === pickup).state, 'done');
  assert.ok(c.items.slice(0, 406).every(item => item.group !== 'move_speed' && item.state === 'todo'));
  assert.ok(c.items.slice(406, 692).every(item => item.group === 'move_speed' && item.state !== 'done'));
  assert.equal(c.items[692].id, pickup);
  assert.ok(c.items.slice(693).every(item => item.group === 'move_speed' && item.state === 'done'));
  assert.equal(c.groups.at(-1).key, 'move_speed');
  for (const [tribe, state, count] of [[first, 'done', 5], [second, 'active', 3], [third, 'done', 5], [fourth, 'todo', 0]]) {
    const reward = c.items.find(item => item.id === `capture-bonus:${tribe}`);
    assert.equal(reward.state, state);
    assert.ok(reward.detail.endsWith(`${count}/5`));
  }
});

test('Movement Speed is a Statue of Power upgrade even though Mimog Effigies have no map pickups', () => {
  const c = category('statue', {});
  const speed = c.items.find(item => item.id === 'MoveSpeed');
  assert.equal(c.total, 13);
  assert.equal(speed.name, 'Movement Speed');
  assert.equal(speed.no, 0);
  assert.equal(speed.noMax, 92);
  assert.equal(speed.state, 'todo');
  assert.equal(data.relicTypes.find(type => type.enum === 'MoveSpeed').item, 'Mimog Effigy');
  const { mapObjectives } = require('../src/app/completion/tracker-map-model.ts');
  const pickups = mapObjectives([category('relics', {}), c]);
  assert.equal(pickups.length, 407);
  assert.ok(!pickups.some(point => point.item.name === 'Mimog Effigy' || point.item.id === 'MoveSpeed'));
});

test('Statue of Power follows effigy filter order with missing and active ranks together', () => {
  const filterOrder = category('relics', {}).groups.map(group => data.relicTypes.find(type => type.key === group.key).enum);
  const progress = { relics: { HungerReduction: ['one'], ClimbSpeed: ['two'] } };
  const c = category('statue', progress);
  assert.deepEqual(c.items.map(item => item.id), filterOrder);
  assert.equal(c.items[0].state, 'todo');
  assert.equal(c.items[1].state, 'active');
  const maxRank = data.statueRanks.HungerReduction.reduce((sum, cost) => sum + cost, 0);
  const completed = category('statue', { relics: { HungerReduction: Array.from({ length: maxRank }, (_, i) => String(i)) } });
  assert.deepEqual(completed.items.map(item => item.id), [...filterOrder.filter(id => id !== 'HungerReduction'), 'HungerReduction']);
  assert.equal(completed.items.at(-1).state, 'done');
});

test('Movement Speed uses completed capture bonuses, subtracts held effigies, and counts species aliases once', () => {
  const c = category('statue', {
    capture_bonus_counts: { A: 5, a: 5, B: 9, C: 5, D: 5, E: 5, F: 5, Almost: 4 },
    capture_counts: { Almost: 100 },
    relics_unspent: { MoveSpeed: 2, CapturePower: 4 },
  });
  const speed = c.items.find(item => item.id === 'MoveSpeed');
  assert.equal(speed.no, 2);
  assert.equal(speed.state, 'active');
  assert.equal(speed.detail, '2 held · 3 more for next rank');
  assert.match(c.items.find(item => item.id === 'CapturePower').detail, /^4 held/);
});

test('Movement Speed handles maximum rank and unspent reward balances', () => {
  const capture_bonus_counts = Object.fromEntries(Array.from({ length: 288 }, (_, i) => [`Species${i}`, 5]));
  const speed = category('statue', { capture_bonus_counts, relics_unspent: { MoveSpeed: 1 } }).items.find(item => item.id === 'MoveSpeed');
  assert.equal(speed.no, 92);
  assert.equal(speed.state, 'done');
  assert.equal(speed.detail, '1 held');
  const unspent = category('statue', { capture_bonus_counts: { A: 5 }, relics_unspent: { MoveSpeed: 1 } }).items.find(item => item.id === 'MoveSpeed');
  assert.equal(unspent.no, 0);
  assert.equal(unspent.detail, '1 held · 1 more for next rank');
});

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
