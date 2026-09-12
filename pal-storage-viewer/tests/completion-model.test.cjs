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

test('obtained but unread journals count as not read until LocalData marks them checked', () => {
  const save = record({ notes: ['Day0', 'GrassBoss3'] });
  const notes = checkedNotes => summarize(save, data, { labs: [], checkedNotes }).categories.find(c => c.key === 'notes');
  const missing = notes(null), empty = notes([]), checked = notes(['day0']);
  assert.equal(missing.items.find(i => i.id === 'Day0').checked, null);
  assert.equal(empty.items.find(i => i.id === 'Day0').checked, false);
  assert.equal(checked.items.find(i => i.id === 'Day0').checked, true);
  assert.equal(checked.items.find(i => i.id === 'GrassBoss3').checked, false);
  assert.equal(missing.items.find(i => i.id === 'Day0').state, 'done');
  assert.equal(checked.items.find(i => i.id === 'Day0').state, 'done');
  assert.equal(checked.items.find(i => i.id === 'GrassBoss3').state, 'active');
  assert.equal(empty.items.find(i => i.id === 'GrassBoss3').state, 'active');
  assert.equal(missing.done, 2);
  assert.equal(checked.done, 1);
  assert.equal(empty.done, 0);
  assert.equal(checked.total, missing.total);
});

test('seen and butchered columns preserve completion and distinguish unknown from zero', () => {
  const save = record({ butcher_counts: { Penguin: 2, PENGUIN: 3, Human: 4 }, counters: { awakenings: 7 } });
  const original = summarize(save, data);
  const summary = summarize(save, data, { labs: [], seenSpecies: ['PENGUIN'], keyItems: 87,
    attributes: { allocated: { '最大HP': 22 }, extra: { '最大HP': 13, '最大SP': 24 } } });
  const pal = (s, key, id) => s.categories.find(c => c.key === key).items.find(i => i.id === id);
  assert.equal(pal(original, 'paldeck', 'Penguin').seen, null);
  assert.equal(pal(summary, 'paldeck', 'Penguin').seen, true);
  assert.equal(pal(summary, 'paldeck', 'SheepBall').seen, false);
  assert.equal(pal(summary, 'captureBonus', 'Penguin').butchered, 3);
  assert.equal(pal(summary, 'captureBonus', 'SheepBall').butchered, 0);
  assert.equal(summary.percent, original.percent);
  const entry = label => summary.stats.find(e => e.label === label);
  assert.equal(entry('Butchered').value, '7');
  assert.equal(entry('Awakenings').value, '7');
  assert.equal(entry('Key items').value, '87');
  assert.deepEqual(entry('Attributes').tooltip.rows, [['HP', '22 + 13'], ['Stamina', '0 + 24']]);
  assert.equal(original.stats.find(e => e.label === 'Key items').value, '?');
});

test('condensation tooltip uses lifetime rank counts with one-based save ranks', () => {
  const stats = summarize(record({ rankup_counts: { '2': 60, '3': 42, '5': 35 } }), data).stats;
  const entry = stats.find(stat => stat.label === '4-star pals');
  assert.equal(entry.value, '35');
  assert.deepEqual(entry.tooltip.rows, [['1 ★', '60'], ['2 ★', '42'], ['3 ★', '0'], ['4 ★', '35']]);
  assert.equal(entry.tooltip.title, 'Lifetime Pals Condensed');
  assert.equal(entry.tooltip.note, undefined);
});

test('summary totals include repeated events and IDs outside the tracker catalog', () => {
  const save = record({
    counters: { tribe_captures: 22 },
    paldeck: ['Penguin'],
    capture_counts: { Penguin: 12, PENGUIN: 15, Human: 3, WorldTreeDragon: 2 },
    tower_boss_counts: { Tower: 3, Tower_Hard: 2 },
    raid_boss_counts: { Raid: 7, RAID: 6 },
    fishing_counts: { UnknownFish: 4, Penguin: 2, Invalid: -1 },
    crafted_item_counts: { UnknownItem: 100, UNKNOWNITEM: 90, AnotherItem: 8, Invalid: NaN },
  });
  const result = summarize(save, data, { labs: [], bases: 5, pals: 1234 });
  const values = Object.fromEntries(result.stats.map(entry => [entry.label, entry.value]));
  assert.equal(values['Bases'], '5');
  assert.equal(values['Pals'], (1234).toLocaleString());
  assert.equal(values['Caught species'], '22');
  assert.equal(values['Total Pals captured'], '20');
  assert.equal(values['Tower clears'], '5');
  assert.equal(values['Raid boss clears'], '7');
  assert.equal(values['Fishing catches'], '6');
  assert.equal(values['Items crafted'], '108');
  const withoutCounts = summarize(save, data, { labs: [] });
  assert.equal(result.percent, withoutCounts.percent);
  assert.equal(result.done, withoutCounts.done);
  assert.equal(result.total, withoutCounts.total);
});

test('summary distinguishes unavailable data from recorded zeroes and keeps lower-star condensation visible', () => {
  const missing = summarize(record({ crafted_item_counts: null, fishing_counts: null, rankup_counts: { '2': 9 } }), data);
  for (const label of ['Bases', 'Pals', 'Caught species', 'Items crafted', 'Fishing catches']) {
    const entry = missing.stats.find(entry => entry.label === label);
    assert.equal(entry.value, '?', label);
    assert.equal(entry.missing, true, label);
    assert.ok(entry.title);
  }
  assert.match(missing.stats.find(entry => entry.label === 'Bases').title, /not recorded in the loaded save\./);
  const stars = missing.stats.find(entry => entry.label === '4-star pals');
  assert.equal(stars.value, '0');
  assert.deepEqual(stars.tooltip.rows[0], ['1 ★', '9']);
  const empty = summarize(record({ crafted_item_counts: {}, fishing_counts: {}, counters: { tribe_captures: 0 } }), data, { labs: [], bases: 0, pals: 0 });
  for (const label of ['Bases', 'Pals', 'Caught species', 'Items crafted', 'Fishing catches', 'Tower clears', 'Raid boss clears', 'Total Pals captured']) {
    const entry = empty.stats.find(entry => entry.label === label);
    assert.equal(entry.value, '0', label);
    assert.equal(entry.missing, false, label);
  }
});

test('capture rows distinguish absent inventory data from zero owned and preserve completion', () => {
  const progress = record({ capture_bonus_counts: { Penguin: 5 } });
  const capture = world => summarize(progress, data, world).categories.find(c => c.key === 'captureBonus');
  const missing = capture({ labs: [] });
  const populated = capture({ labs: [], ownedCondensation: { PENGUIN: [6, 4, 3, 2, 1] } });
  assert.equal(missing.items.find(item => item.id === 'Penguin').condensed, null);
  assert.deepEqual(populated.items.find(item => item.id === 'Penguin').condensed, [6, 4, 3, 2, 1]);
  assert.deepEqual(populated.items.find(item => item.id === 'Penguin_Electric').condensed, [0, 0, 0, 0, 0]);
  assert.equal(populated.done, missing.done);
  assert.equal(populated.total, missing.total);
  assert.equal(populated.percent, missing.percent);
});

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
  assert.equal(c.items.filter(item => item.state === 'todo').length, 1270);
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

test('crafting sorts by direct or inherited tech level regardless of crafted status', () => {
  const c = category('crafting', { crafted_item_counts: { AssaultRifle_Default1: 1 } });
  const item = id => c.items.find(item => item.id === id);
  assert.deepEqual(item('AssaultRifle_Default1').crafting.technologyLevels, [45]);
  assert.deepEqual(item('AssaultRifle_Default1').crafting.inheritedTechnologyLevels, []);
  for (const id of ['AssaultRifle_Default5', 'Blueprint_AssaultRifle_Default5']) {
    assert.deepEqual(item(id).crafting.technologyLevels, []);
    assert.deepEqual(item(id).crafting.inheritedTechnologyLevels, [45]);
    assert.equal(item(id).order, 45);
  }
  assert.deepEqual(item('HotMilk').crafting.inheritedTechnologyLevels, []);
  assert.equal(item('HotMilk').order, Number.MAX_SAFE_INTEGER);
  assert.equal(c.items.filter(i => i.crafting.technologyLevels.length).length, 380);
  assert.equal(c.items.filter(i => i.crafting.inheritedTechnologyLevels.length).length, 546);
  for (let n = 1; n < c.items.length; n++) assert.ok(c.items[n - 1].order <= c.items[n].order);
  const uncrafted = category('crafting', { crafted_item_counts: {} });
  assert.deepEqual(c.items.map(i => i.id), uncrafted.items.map(i => i.id));
  assert.deepEqual(c.items.filter(i => i.name === 'Assault Rifle').map(i => i.crafting.rarity), [0, 1, 2, 3, 4]);
  const bait = c.items.find(i => i.name === 'Simple Bait');
  assert.deepEqual(bait.crafting.technologyLevels, [15, 29, 45]);
  assert.equal(bait.order, 15);
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

test('crafting metadata preserves item variants, direct technology levels, and food stats', () => {
  const items = category('crafting', { crafted_item_counts: {} }).items;
  const craft = id => items.find(item => item.id === id).crafting;
  const rifle = craft('AssaultRifle_Default1');
  assert.equal(rifle.group, 'Weapons');
  assert.equal(rifle.weight, 15);
  assert.equal(rifle.baseValue, 57600);
  assert.equal(rifle.stackLimit, 1);
  assert.deepEqual(rifle.technologyLevels, [45]);
  assert.deepEqual(rifle.stats, [['Attack', 320], ['Durability', 3000], ['Magazine', 20]]);
  assert.equal(rifle.recipes[0].workAmount, 100000);
  const legendary = craft('AssaultRifle_Default5');
  assert.deepEqual(legendary.technologyLevels, []);
  assert.equal(legendary.baseValue, 120000);
  assert.deepEqual(legendary.stats, [['Attack', 560], ['Durability', 6000], ['Magazine', 30]]);
  assert.equal(legendary.recipes[0].workAmount, 3200000);
  const milk = craft('HotMilk');
  assert.equal(milk.weight, 1.5);
  assert.equal(milk.stackLimit, 9999);
  assert.deepEqual(milk.stats, [['Nutrition', 16], ['SAN', 1]]);
  assert.deepEqual(craft('Pal_crystal_S').stats, []);
  assert.ok(craft('Pal_crystal_S').recipes.every(recipe => recipe.workAmount === 1000));
  assert.ok(new Set(craft('Pal_crystal_S').recipes.map(recipe => recipe.quantity)).size > 1);
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

test('Astralym is excluded from capture objectives but remains a tracked boss', () => {
  for (const progress of [{}, {
    paldeck: ['WORLDTREEDRAGON'],
    capture_counts: { WorldTreeDragon: 5 },
    capture_bonus_counts: { WorldTreeDragon: 5 },
  }]) {
    for (const key of ['paldeck', 'captureBonus']) {
      const c = category(key, progress);
      assert.equal(c.total, 287);
      assert.equal(c.done, 0);
      assert.ok(!c.items.some(item => item.id === 'WorldTreeDragon'));
      assert.deepEqual(c.unknown, []);
    }
    const effigies = category('relics', progress);
    assert.equal(effigies.done, 0);
    assert.ok(!effigies.items.some(item => item.id === 'capture-bonus:WorldTreeDragon'));
  }
  const bossId = 'BOSS_BATTLE_NAME_WorldTreeBoss';
  assert.equal(category('towers', {}).items.find(item => item.id === bossId).state, 'todo');
  assert.equal(category('towers', { tower_bosses: [bossId] }).items.find(item => item.id === bossId).state, 'done');
});

test('Pal Effigies includes each obtainable species capture reward in its total and Mimog group', () => {
  const c = category('relics', {});
  const rewards = c.items.filter(item => item.group === 'move_speed');
  assert.equal(c.total, 694);
  assert.equal(c.done, 0);
  assert.equal(rewards.length, 287);
  assert.equal(new Set(c.items.map(item => item.id)).size, c.total);
  assert.deepEqual(c.groups.find(group => group.key === 'move_speed'),
    { key: 'move_speed', name: 'Mimog Effigy', done: 0, total: 287 });
  for (const [tribe, , name] of data.paldeck.filter(([id]) => id !== 'WorldTreeDragon')) {
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
  assert.equal(c.total, 694);
  assert.equal(c.done, 3);
  assert.equal(c.groups.find(group => group.key === 'move_speed').done, 2);
  assert.equal(c.items.find(item => item.id === pickup).state, 'done');
  assert.ok(c.items.slice(0, 406).every(item => item.group !== 'move_speed' && item.state === 'todo'));
  assert.ok(c.items.slice(406, 691).every(item => item.group === 'move_speed' && item.state !== 'done'));
  assert.equal(c.items[691].id, pickup);
  assert.ok(c.items.slice(692).every(item => item.group === 'move_speed' && item.state === 'done'));
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
  assert.equal(c.items.find(i => i.id === 'Free').detail, '0');
  assert.equal(c.items.find(i => i.id === 'Ancient').detail, '7');
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
  assert.equal(c.total, 31);
  assert.equal(c.done, 1);
  assert.deepEqual(c.unknown, []);
  assert.ok(!c.items.some(i => i.id === 'Main_PickupWood'));
  assert.ok(!c.items.some(i => i.id === 'Main_DefeatWorldTreeMiddleBoss'));
});

test('Path to the Abyss is excluded without inventing completion or discarding its raw flag', () => {
  const current = category('mainQuests', {}).items.map(i => i.id);
  assert.ok(!current.includes('Main_DefeatWorldTreeMiddleBoss'));
  const c = category('mainQuests', { quests_completed: current });
  assert.equal(c.done, 31);
  assert.equal(c.total, 31);
  assert.equal(c.percent, 100);
  const saved = record({ quests_completed: [...current, 'MAIN_DEFEATWORLDTREEMIDDLEBOSS'] });
  const summary = summarize(saved, data);
  assert.deepEqual(summary.categories.find(c => c.key === 'mainQuests'), c);
  assert.equal(summary.percent, summarize(record({ quests_completed: current }), data).percent);
  assert.ok(saved.quests_completed.includes('MAIN_DEFEATWORLDTREEMIDDLEBOSS'));
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

test('arena counts seven tiers toward completion and keeps points independent', () => {
  const baseline = summarize(record(), data);
  const summary = summarize(record({ arena_solo_clears: { bronze: 1, Silver: 2, Gold: 0, FutureTier: 1 } }), data,
    { labs: [], arenaPoints: 0 });
  const arena = summary.categories.find(c => c.key === 'arena');
  assert.equal(arena.total, 7);
  assert.equal(arena.done, 2);
  assert.equal(arena.percent, 28.6);
  assert.equal(arena.items.find(i => i.id === 'Bronze').state, 'done');
  assert.equal(arena.items.find(i => i.id === 'Gold').state, 'todo');
  assert.equal(arena.items.find(i => i.id === 'Legend').state, 'todo');
  assert.deepEqual(arena.unknown, ['FutureTier']);
  assert.equal(arena.items.length, 7);
  assert.equal(arena.arenaPoints.value, '0');
  assert.equal(arena.arenaPoints.missing, false);
  assert.equal(arena.hasCoords, false);
  assert.equal(arena.hasNumbers, false);
  assert.equal(summary.done, baseline.done + 2);
  assert.equal(summary.total, baseline.total);
  const counted = summary.categories.filter(c => c.total > 0 && !c.needsFile && !c.unavailable);
  assert.equal(summary.percent, Math.round(counted.reduce((sum, c) => sum + c.percent, 0) / counted.length * 10) / 10);
  const all = category('arena', { arena_solo_clears: Object.fromEntries(arena.items.map(i => [i.id, 1])) });
  assert.equal(all.done, 7);
  assert.equal(all.total, 7);
  assert.equal(all.percent, 100);
  assert.equal(all.arenaPoints.missing, true);
  const unknown = baseline.categories.find(c => c.key === 'arena');
  assert.ok(unknown.unavailable);
  assert.equal(unknown.arenaPoints.value, '?');
  assert.match(unknown.arenaPoints.title, /not recorded in the loaded save\./);
  assert.equal(category('arena', { arena_solo_clears: {} }).unavailable, undefined);
});
