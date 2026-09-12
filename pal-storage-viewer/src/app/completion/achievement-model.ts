import type { CompletionCounters, PlayerCompletion } from '../../backend';
import type { CompletionData, TrackedItem, WorldProgress } from './completion-model';
import { ACHIEVEMENTS, ACHIEVEMENT_BOUNTY_TOKEN_FLAGS, ACHIEVEMENT_ITEM_REDIRECTS, ACHIEVEMENT_ITEM_TYPES, AchievementDefinition } from './achievement-data';

export interface AchievementProgress {
  description: string;
  current: number | null;
  target: number;
  unknown: boolean;
}

const keyOf = (id: string): string => id.split('::').pop()!.toLowerCase();
const redirects = new Map(Object.entries(ACHIEVEMENT_ITEM_REDIRECTS).map(([id, to]) => [keyOf(id), keyOf(to)]));
function itemKey(id: string): string {
  let key = keyOf(id);
  const seen = new Set<string>();
  while (redirects.has(key) && !seen.has(key)) { seen.add(key); key = redirects.get(key)!; }
  return key;
}
const itemTypes = new Map(Object.entries(ACHIEVEMENT_ITEM_TYPES).map(([type, ids]) => [type, new Set(ids.map(itemKey))]));
const bountyTokens = Object.entries(ACHIEVEMENT_BOUNTY_TOKEN_FLAGS).map(([item, flag]) => [itemKey(item), keyOf(flag)]);
const hardTowers = ['GrassBoss', 'ForestBoss', 'ElectricBoss', 'DesertBoss', 'SnowBoss', 'SakurajimaBoss'];
const treeQuests = ['Main_ReachWorldTree', 'Main_TalkWorldTreeNPC', 'Main_DefeatWorldTreeMiddleBoss',
  'Main_WorldTreeAbyss', 'Main_DefeatWorldTreeDragon'];

function counts(values: Record<string, number> | null | undefined, normalize = keyOf): Map<string, number> {
  const result = new Map<string, number>();
  for (const [id, value] of Object.entries(values ?? {})) {
    if (!Number.isFinite(value) || value < 0) continue;
    const key = normalize(id);
    result.set(key, Math.max(result.get(key) ?? 0, value));
  }
  return result;
}
const sum = (map: Map<string, number>): number => [...map.values()].reduce((a, b) => a + b, 0);
const unique = (ids: string[]): Set<string> => new Set(ids.filter(id => id && keyOf(id) !== 'none').map(keyOf));
const finite = (value: number | null | undefined): number | null => value != null && Number.isFinite(value) && value >= 0 ? value : null;

export function achievementItems(record: PlayerCompletion, data: CompletionData, world?: WorldProgress): TrackedItem[] {
  const fields = record.recorded_fields ? new Set(record.recorded_fields) : null;
  const has = (...names: string[]): boolean => !fields || names.some(name => fields.has(name));
  const captures = counts(record.capture_counts), towerCounts = counts(record.tower_boss_counts);
  const towerFlags = unique(record.tower_bosses), raids = counts(record.raid_boss_counts);
  const crafts = counts(record.crafted_item_counts, itemKey), fishing = counts(record.fishing_counts);
  const palCaptures = new Map([...captures].filter(([id]) => id !== 'human' && id !== 'none'));
  const quests = unique(record.quests_completed), maps = unique(record.world_maps);
  const tower = (id: string): boolean => towerFlags.has(keyOf('BOSS_BATTLE_NAME_' + id)) || (towerCounts.get(keyOf(id + '_Normal')) ?? 0) > 0;
  const worldMissing = world?.hasLevel === false || !world
    ? 'Add Level.sav with "+ Files".' : 'Required data was not recorded in the loaded save.';
  const guild = world?.guildAchievements;
  const guildMissing = world?.hasLevel === false || !world ? worldMissing : 'Guild progress or player membership was not recorded in the loaded save.';

  function evaluate(a: AchievementDefinition): { current: number | null; note?: string; uncertain?: boolean } {
    switch (a.kind) {
      case 'tower': return { current: tower(a.key) ? 1 : has('TowerBossDefeatFlag', 'TowerBossDefeatCount') ? 0 : null };
      case 'raid': return { current: (raids.get(keyOf(a.key)) ?? 0) > 0 ? 1 : has('RaidBossDefeatCount') ? 0 : null };
      case 'capture': return { current: has('PalCaptureCount') ? Math.min(captures.get(keyOf(a.key)) ?? 0, 1) : null };
      case 'captures': return { current: has('PalCaptureCount') ? sum(palCaptures) : null };
      case 'species': return { current: has('PalCaptureCount') ? [...palCaptures.values()].filter(n => n > 0).length : null };
      case 'notes': return { current: has('NoteObtainForInstanceFlag') ? unique(record.notes).size : null, note: 'Obtained 40 journals' };
      case 'areas': return { current: has('FindAreaFlagMap') ? unique(record.areas).size : null };
      case 'relic': {
        const available = has('RelicObtainForInstanceFlagByType') || a.key === 'CapturePower' && has('RelicObtainForInstanceFlag');
        const ids = Object.entries(record.relics).filter(([key]) => keyOf(key) === keyOf(a.key)).flatMap(([, ids]) => ids);
        return { current: available ? unique(ids).size : null };
      }
      case 'condensation': return { current: has('PalRankupCount') ? counts(record.rankup_counts).get('5') ?? 0 : null };
      case 'counter': {
        const current = finite(record.counters[a.key as keyof CompletionCounters]);
        if (a.key === 'awakenings') return { current: current ?? 0, uncertain: current === null,
          note: current === null ? 'Awakening count was not recorded in the loaded save. Assuming 0.' : 'Uses the recorded lifetime awakening count.' };
        return { current,
          note: a.key === 'normal_dungeon_clears' ? 'Ordinary dungeon clears.' : a.key === 'predator_defeats' ? 'Uses the recorded predator-defeat total.' : undefined };
      }
      case 'craft': return { current: record.crafted_item_counts == null ? null
        : sum(new Map([...crafts].filter(([id]) => itemTypes.get(a.key)!.has(id)))),
        note: a.key === 'MaterialIngot' ? 'Includes charcoal and other materials in the game\'s ingot category.'
          : a.key === 'ConsumeBullet' ? 'Includes arrows; counts quantities, not distinct items.' : 'Counts sphere quantities, not distinct recipes.' };
      case 'hard': return { current: has('TowerBossDefeatCount') ? hardTowers.filter(id => (towerCounts.get(keyOf(id + '_Hard')) ?? 0) > 0).length : null,
        note: 'Zoe, Lily, Axel, Marcus, Victor and Saya in Hard Mode.' };
      case 'research': return { current: guild?.research == null ? null : data.research.filter(([id, , , work]) => work > 0 && (guild.research![id] ?? 0) >= work - 0.5).length,
        note: guild?.research == null ? guildMissing : 'Completed projects in this player\'s guild.' };
      case 'expedition': return { current: finite(guild?.expeditions), note: guild?.expeditions == null ? guildMissing : 'Expedition total recorded for this player\'s guild.' };
      case 'chopper': return { current: record.specific_boss_counts == null ? null : Math.min(counts(record.specific_boss_counts).get('securitydrone') ?? 0, 1) };
      case 'fishing': return { current: record.fishing_counts == null ? null : sum(fishing) };
      case 'lunker': return { current: record.fishing_counts == null ? null : Math.min(sum(new Map([...fishing].filter(([id]) => id.endsWith('_nushi')))), 1) };
      case 'tokens': {
        const flags = unique(record.bosses);
        return { current: has('NormalBossDefeatFlag') ? new Set(bountyTokens.filter(([, flag]) => flags.has(flag)).map(([item]) => item)).size : null,
          note: has('NormalBossDefeatFlag') ? 'Distinct Pal bounty tokens recorded by boss-defeat flags.' : 'Pal bounty tokens were not recorded in the loaded save.' };
      }
      case 'friendship': return { current: finite(world?.maxFriendship), note: world?.maxFriendship == null
        ? world?.friendshipUnavailable ?? 'Add the matching LocalData.sav with "+ Files" and select its owner.' : 'Highest friendship rank recorded for the LocalData owner.' };
      case 'arena': {
        const recorded = finite(world?.arenaPoints);
        const current = recorded ?? (world?.hasLevel ? 0 : null);
        return { current, uncertain: current != null && current < a.target,
          note: current == null ? world?.arenaPointsUnavailable ?? worldMissing
            : recorded === null ? 'Arena Points were not recorded in the loaded save. Assuming 0.'
            : current < a.target ? 'Recorded RP does not establish whether this rank was reached before.' : 'Current RP threshold reached.' };
      }
      case 'tree': {
        const entered = treeQuests.some(id => quests.has(keyOf(id))) || tower('WorldTreeBoss') || maps.has('tree');
        return { current: entered ? 1 : has('CompletedQuestArray_FullRelease', 'UnlockedWorldMapFlags') ? 0 : null,
          note: 'Accepts the entry quest, World Tree map unlock or later interior story completion.' };
      }
    }
  }

  return ACHIEVEMENTS.map((definition, order) => {
    const { current: recorded, note, uncertain } = evaluate(definition);
    const current = recorded ?? 0;
    const unknown = recorded === null || !!uncertain;
    const state = !unknown && current >= definition.target ? 'done' : current > 0 ? 'active' : 'todo';
    const detail = note ?? (recorded === null ? 'Required progress was not recorded in the loaded save.' : '');
    return { id: definition.id, name: definition.name, order, state, no: null, coords: '', map: '', group: definition.group,
      detail: recorded === null ? `${detail} Assuming 0.` : detail,
      achievement: { description: definition.description, current, target: definition.target, unknown },
    };
  });
}
