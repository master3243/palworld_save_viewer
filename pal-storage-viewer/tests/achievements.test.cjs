const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, f);
const { achievementItems } = require('../src/app/completion/achievement-model.ts');
const { ACHIEVEMENTS, ACHIEVEMENT_BOUNTY_TOKEN_FLAGS } = require('../src/app/completion/achievement-data.ts');
const { summarize } = require('../src/app/completion/completion-model.ts');
const { SaveBuffer } = require('../src/backend/gvas.ts');
const { extractPlayerCompletion } = require('../src/backend/completion.ts');
const { expeditionCount, extractMaxFriendship, guildMembers } = require('../src/backend/achievement-progress.ts');
const { combineSaves } = require('../src/backend/combine.ts');
const data = require('../../resources/completion/completion-data.json');
const empty = extra => ({
  ...Object.fromEntries('tower_bosses bosses paldeck notes item_pickups fast_travel areas area_barriers world_maps npc_achievements pal_display quests_completed quests_active skins technologies'.split(' ').map(k => [k, []])),
  ...Object.fromEntries('tower_boss_counts raid_boss_counts capture_counts capture_bonus_counts relics relics_unspent rankup_counts counters'.split(' ').map(k => [k, {}])),
  crafted_item_counts: null, fishing_counts: null, ...extra,
});
const get = (name, extra, world) => achievementItems(empty(extra), data, world).find(r => r.name === name);
const int = n => { const b = Buffer.alloc(4); b.writeInt32LE(n); return b; };
const str = s => Buffer.concat([int(s.length + 1), Buffer.from(s + '\0')]);
const map = (name, keyType, valueType, entries, count) => {
  const body = Buffer.concat([int(0), int(count), ...entries]);
  return Buffer.concat([str(name), str('MapProperty'), int(body.length), int(0), str(keyType), str(valueType), Buffer.from([0]), body]);
};

test('75 unique rows preserve confidence split and unknown data never counts as completion', () => {
  assert.equal(ACHIEVEMENTS.length, 75);
  assert.equal(new Set(ACHIEVEMENTS.map(a => a.name)).size, 75);
  assert.deepEqual([1,2,3].map(b => ACHIEVEMENTS.filter(a => a.bucket === b).length), [65,7,3]);
  const c = summarize(empty({ recorded_fields: [] }), data).categories.find(c => c.key === 'achievements');
  assert.equal(c.total, 75); assert.equal(c.done, 0); assert.equal(c.unknownCount, 75);
});

test('capture history deduplicates case, excludes humans/None, and retains off-catalog species', () => {
  const capture_counts = { Penguin: 990, PENGUIN: 995, Human: 100, None: 999, FutureSpecies: 5, Invalid: -1 };
  assert.equal(get('Overhunting', { capture_counts }).achievement.current, 1000);
  assert.equal(get('Newbie Pal Tamer', { capture_counts }).achievement.current, 2);
  assert.equal(get('Inhuman Act', { capture_counts }).state, 'done');
  assert.equal(get('Legendary Celestial Dragon', { bosses: ['JetDragon'] }).state, 'todo');
  assert.equal(get('Legendary Celestial Dragon', { capture_counts: { JETDRAGON: 1 } }).state, 'done');
});

test('named encounters do not substitute unrelated bosses, Ultra variants or newer hard towers', () => {
  assert.equal(get('Eclipsed Siren', { raid_boss_counts: { PalSummon_NightLady_Dark_2: 10 } }).state, 'todo');
  assert.equal(get('Twilight Siren', { raid_boss_counts: { PalSummon_NightLady: 1 } }).state, 'done');
  assert.equal(get('Hillside Sovereign', { tower_bosses: ['BOSS_BATTLE_NAME_GrassBoss'] }).state, 'done');
  const tower_boss_counts = Object.fromEntries(['GrassBoss','ForestBoss','ElectricBoss','DesertBoss','SnowBoss','SakurajimaBoss'].map(id => [id + '_Hard', 1]));
  assert.equal(get('Champion of the Palpagos Islands', { tower_boss_counts }).state, 'done');
  delete tower_boss_counts.SakurajimaBoss_Hard;
  Object.assign(tower_boss_counts, { VikingBoss_Hard: 20, WorldTreeBoss_Hard: 20 });
  assert.equal(get('Champion of the Palpagos Islands', { tower_boss_counts }).achievement.current, 5);
  assert.equal(get('No-Fly Zone', { specific_boss_counts: { SecurityDrone_Field: 1 } }).state, 'todo');
  assert.equal(get('No-Fly Zone', { specific_boss_counts: { SecurityDrone: 1 } }).state, 'done');
});

test('craft thresholds count units including charcoal and arrows, and distinguish missing from zero', () => {
  assert.equal(get('Sphere Craftsman', { crafted_item_counts: { PalSphere: 1999 } }).state, 'active');
  assert.equal(get('Sphere Craftsman', { crafted_item_counts: { PalSphere: 1999, PalSphere_Mega: 1, RandomItem: 99999 } }).state, 'done');
  assert.equal(get('Iron Heart', { crafted_item_counts: { Charcoal: 9999, Plastic: 1, CopperOre: 90000 } }).achievement.current, 10000);
  assert.equal(get('Blood and Iron', { crafted_item_counts: { Arrow: 19999, HandgunBullet: 1 } }).state, 'done');
  assert.equal(get('Blood and Iron', { crafted_item_counts: {} }).achievement.unknown, false);
  assert.equal(get('Blood and Iron', {}).achievement.unknown, true);
});

test('lifetime collection and condensation are independent of held items and journal checks', () => {
  const relics = { CapturePower: Array.from({ length: 50 }, (_, i) => 'id' + i) };
  assert.equal(get('Palpagos Guru', { relics, relics_unspent: { CapturePower: 0 } }).state, 'done');
  assert.equal(get('All for One', { rankup_counts: { '5': 1 } }).state, 'done');
  assert.equal(get('Voice of Resentment', { rankup_counts: { '5': 4, '4': 100 } }).state, 'active');
  assert.equal(get('Trail of the Castaway', { notes: Array.from({ length: 40 }, (_, i) => 'note' + i) }, { labs: [], checkedNotes: [] }).state, 'done');
  const fishing_counts = { FishShadow_Small: 9, FishShadow_Large_Nushi: 1 };
  assert.equal(get('Novice Angler', { fishing_counts }).state, 'done');
  assert.equal(get('Lunker Hunter', { fishing_counts }).state, 'done');
  assert.equal(get('Lunker Hunter', { capture_counts: { Penguin: 100 } }).achievement.unknown, true);
});

test('guild checks require membership', () => {
  const research = Object.fromEntries(data.research.map(([id, , , work]) => [id, work]));
  assert.equal(get('Pal Labor Student', {}, { labs: [research] }).achievement.current, null);
  assert.equal(get('Pal Labor Professor', {}, { labs: [], guildAchievements: { research, expeditions: 20 } }).state, 'done');
  assert.equal(get('Elite Pal Dispatcher', {}, { labs: [], guildAchievements: { research: {}, expeditions: 19 } }).state, 'active');
  assert.equal(get('Elite Pal Dispatcher', {}, { labs: [], guildAchievements: { research: {}, expeditions: 20 } }).state, 'done');
});

test('Pal bounty tokens come from mapped boss flags, not inventory-only rewards or arbitrary defeats', () => {
  const keyItemIds = ['BossDefeatReward_Mothman', 'BossDefeatReward_BossRush', 'BossDefeatReward_FlowerPrince', 'BountyProof_1'];
  const bosses = ['1_10_plain_F_Boss_FairyDragon', '1_10_PLAIN_F_BOSS_FAIRYDRAGON', '81_2_dessert_FBOSS_2', 'UnknownBoss'];
  assert.equal(get('Rookie Pal Slayer', { bosses }, { labs: [], keyItemIds }).achievement.current, 2);
  assert.equal(get('Rookie Pal Slayer', { bosses }).achievement.current, 2);
  assert.equal(get('Rookie Pal Slayer', {}, { labs: [], keyItemIds }).achievement.current, 0);
  assert.equal(get('Rookie Pal Slayer', { recorded_fields: [] }, { labs: [], keyItemIds }).achievement.unknown, true);
  assert.equal(get('Rookie Pal Slayer', { recorded_fields: ['NormalBossDefeatFlag'] }).achievement.current, 0);
  const flags = Object.values(ACHIEVEMENT_BOUNTY_TOKEN_FLAGS).slice(0, 20);
  assert.equal(get('Rookie Pal Slayer', { bosses: flags.slice(0, 5) }).state, 'done');
  assert.equal(get('Alpha Pal Slayer', { bosses: flags.slice(0, 19) }).state, 'active');
  assert.equal(get('Alpha Pal Slayer', { bosses: flags }).state, 'done');
});

test('only true boss flags grant tokens and the parser records whether the map exists', () => {
  const buf = new SaveBuffer(Buffer.concat([str('RecordData'), map('NormalBossDefeatFlag', 'NameProperty', 'BoolProperty', [
    str('1_10_plain_F_Boss_FairyDragon'), Buffer.from([1]), str('81_2_dessert_FBOSS_2'), Buffer.from([0]),
  ], 2)]));
  const record = extractPlayerCompletion(buf);
  assert.ok(record.recorded_fields.includes('NormalBossDefeatFlag'));
  assert.equal(get('Rookie Pal Slayer', record).achievement.current, 1);
});

test('arena uses RP, not seven solo clears; lower RP cannot disprove a past rank', () => {
  const arena_solo_clears = Object.fromEntries(['Bronze','Silver','Gold','Platinum','Diamond','Master','Legend'].map(k => [k, 1]));
  const world = { labs: [], arenaPoints: 1835 };
  assert.equal(get('Silver Champ', { arena_solo_clears }, world).state, 'done');
  assert.equal(get('Arena Legend', { arena_solo_clears }, world).achievement.unknown, true);
  assert.equal(get('Arena Legend', {}, { labs: [], arenaPoints: 6000 }).state, 'done');
  assert.equal(get('Arena Champion', {}, { labs: [], arenaPoints: 3800 }).state, 'done');
  assert.equal(get('Arena Legend', {}).achievement.current, null);
});

test('Tree uses interior milestones; friendship uses associated LocalData history', () => {
  assert.equal(get('To the World Tree', { areas: ['FootOfWorldTree'] }).state, 'todo');
  assert.equal(get('To the World Tree', { quests_completed: ['Main_DefeatWorldTreeDragon'] }).state, 'done');
  assert.equal(get('To the World Tree', { world_maps: ['Tree'] }).state, 'done');
  assert.equal(get('To the World Tree', { tower_boss_counts: { WorldTreeBoss_Normal: 1 } }).state, 'done');
  assert.equal(get('Best Friends Forever', {}).achievement.unknown, true);
  assert.equal(get('Best Friends Forever', {}, { labs: [], maxFriendship: 10 }).state, 'done');
  assert.equal(get('Best Friends Forever', {}, { labs: [], maxFriendship: 0 }).state, 'todo');
});

test('binary expedition parser rejects unsupported blocks and invalid counts', () => {
  assert.equal(expeditionCount(Buffer.from('1d01000000000000', 'hex')), 285);
  assert.equal(expeditionCount(Buffer.alloc(8)), 0);
  assert.equal(expeditionCount(Buffer.concat([int(-1), int(0)])), null);
  assert.equal(expeditionCount(Buffer.concat([int(20), int(1)])), null);
  assert.equal(expeditionCount(Buffer.alloc(4)), null);
  assert.equal(guildMembers(Buffer.alloc(5), 'EPalGroupType::Guild'), null);
});

test('friendship parser reads struct keys and refuses malformed or absent maps', () => {
  const guid = Buffer.concat([str('InstanceId'), str('StructProperty'), int(16), int(0), str('Guid'), Buffer.alloc(17), Buffer.alloc(16, 1)]);
  const entry = Buffer.concat([guid, str('None'), int(10)]);
  const buf = new SaveBuffer(map('Local_MaxFriendshipPalIds', 'StructProperty', 'IntProperty', [entry], 1));
  assert.equal(extractMaxFriendship(buf), 10);
  assert.equal(extractMaxFriendship(new SaveBuffer(map('Local_MaxFriendshipPalIds', 'StructProperty', 'IntProperty', [], 0))), 0);
  assert.equal(extractMaxFriendship(new SaveBuffer(buf.bytes.subarray(0, buf.length - 1))), null);
  assert.equal(extractMaxFriendship(new SaveBuffer(Buffer.alloc(0))), null);
});

test('player parser exports chopper counter and records which history fields were present', () => {
  const buf = new SaveBuffer(Buffer.concat([str('RecordData'), map('SpecificBossDefeatFlag', 'NameProperty', 'IntProperty', [str('SecurityDrone'), int(2)], 1),
    map('PalCaptureCount', 'NameProperty', 'IntProperty', [], 0)]));
  const record = extractPlayerCompletion(buf);
  assert.deepEqual(record.specific_boss_counts, { SecurityDrone: 2 });
  assert.equal(record.counters.awakenings, null);
  assert.ok(record.recorded_fields.includes('PalCaptureCount'));
  assert.equal(get('All for One', record).achievement.current, null);
  assert.equal(get('Beginning of the Legend', record).achievement.current, 0);
});

test('combination keeps player guilds and token containers separate in either arrival order', () => {
  const entry = (kind, payload) => ({ name: kind, set: 'world', letter: 'A', parsed: { kind, payload, class_name: '', saved_at: '' } });
  const a = entry('player', { player_uid: 'a', key_item_container_id: 'bagA', completion: empty() });
  const b = entry('player', { player_uid: 'b', key_item_container_id: 'bagB', completion: empty() });
  const world = entry('level', { records: [], players: [], bases: [], labs: [], containers: {}, skipped: {}, item_counts: {},
    item_ids: { bagA: ['BossDefeatReward_Mothman'], bagB: [] }, guild_achievements: { a: { research: {}, expeditions: 285 }, b: { research: {}, expeditions: 0 } } });
  const local = entry('local_data', { seen_species: [], checked_notes: [], max_friendship: 10 });
  for (const files of [[a,b,world,local],[local,world,b,a]]) {
    const set = combineSaves(files).sets[0];
    assert.equal(set.players.find(p => p.uid === 'a').guild_achievements.expeditions, 285);
    assert.equal(set.players.find(p => p.uid === 'b').guild_achievements.expeditions, 0);
    assert.deepEqual(set.players.find(p => p.uid === 'b').key_item_ids, []);
    assert.equal(set.max_friendship, 10);
  }
  assert.equal(combineSaves([a,world,local,local]).sets[0].max_friendship, null);
  assert.equal(combineSaves([a]).sets[0].players[0].guild_achievements, null);
});


test('guild research decoder accepts both selected-project tails and rejects truncated work', () => {
  const { researchWork } = require('../src/backend/achievement-progress.ts');
  const value = Buffer.alloc(4); value.writeFloatLE(1234);
  const body = Buffer.concat([int(1), str('EmitFlame1'), value]);
  for (const tail of [str('None'), Buffer.concat([str('EmitFlame1'), int(0)])]) {
    assert.deepEqual(researchWork(Buffer.concat([body, tail])), { EmitFlame1: 1234 });
  }
  assert.equal(researchWork(body.subarray(0, body.length - 1)), null);
});

test('omitted Arena Points default to zero only with Level loaded; omitted awakenings default to zero only in achievements', () => {
  for (const hasLevel of [false, true]) {
    const world = { labs: [], hasLevel, arenaPoints: null };
    const summary = summarize(empty({ counters: { awakenings: null } }), data, world);
    const arena = summary.categories.find(c => c.key === 'arena');
    assert.equal(arena.arenaPoints.value, hasLevel ? '0' : '?');
    assert.equal(arena.arenaPoints.missing, !hasLevel);
    assert.equal(get('Silver Champ', {}, world).achievement.current, hasLevel ? 0 : null);
    assert.equal(get('Silver Champ', {}, world).achievement.unknown, true);
    const awakenings = summary.stats.find(s => s.label === 'Awakenings');
    assert.equal(awakenings.value, '?');
    assert.equal(awakenings.missing, true);
    assert.equal(awakenings.title, 'Awakening count was not recorded in the loaded save.');
    assert.equal(get('Hidden Potential', { counters: { awakenings: null } }, world).achievement.current, 0);
    assert.equal(get('Hidden Potential', { counters: { awakenings: null } }, world).achievement.unknown, true);
    assert.match(get('Hidden Potential', { counters: { awakenings: null } }, world).detail, /not recorded in the loaded save\. Assuming 0\./);
    if (hasLevel) assert.match(get('Silver Champ', {}, world).detail, /not recorded in the loaded save\. Assuming 0\./);
  }
  assert.equal(get('Hidden Potential', { counters: { awakenings: 0 } }).achievement.unknown, false);
  assert.equal(get('Hidden Potential', { counters: { awakenings: 0 } }).state, 'todo');
  assert.doesNotMatch(get('Silver Champ', {}, { labs: [], hasLevel: true, arenaPoints: 0 }).detail, /assuming/);
  assert.equal(get('Hidden Potential', { counters: { awakenings: 3 } }).state, 'done');
  assert.equal(get('Arena Champion', {}, { labs: [], hasLevel: true, arenaPoints: 3800 }).state, 'done');
});
