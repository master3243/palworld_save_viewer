/**
 * Turns one player's completion record plus the bundled master lists into per-category
 * progress. Pure functions, no Angular, so they can be checked under Node.
 */
import type { PlayerCompletion } from '../../backend';
import { QUEST_REWARDS, UNTRACKED_MAIN_QUESTS } from './mission-rules';

/** Shape of resources/completion/completion-data.json (built by Paltest/db/build_completion_data.py). */
export interface CompletionData {
  generated: string;
  sources: Record<string, string>;
  relicTypes: { key: string; enum: string; name: string; item: string; pal: string }[];
  /** level object id -> [relic type index, x, y, z] */
  relics: Record<string, [number, number, number, number]>;
  /** level object id -> [name, x, y, z, point id, Great Eagle statue?] */
  fastTravel: Record<string, [string, number, number, number, string, number]>;
  /** note id -> [name, x, y, z] */
  notes: Record<string, [string, number, number, number]>;
  /** quest id -> [Main|Sub|Hidden, name, disabled, reference x, y]; side missions use start/giver positions. */
  quests: Record<string, [string, string, number, number, number]>;
  /** [spawner id, name, level, alpha|boss|bounty, x, y, z] */
  bosses: [string, string, number, string, number, number, number][];
  /** tower flag -> [name, x, y, z] */
  towers: Record<string, [string, number, number, number]>;
  /** area id -> [name, x, y] (0, 0 when the region has no known position) */
  areas: Record<string, [string, number, number]>;
  /** level object id -> [x, y, z, item name, item id] */
  ruinPickups: Record<string, [number, number, number, string, string]>;
  /** [tribe id, paldeck number, name] */
  paldeck: [string, number, string][];
  /** [technology id, name, required level, ancient (boss) technology?, point cost] */
  technologies: [string, string, number, number, number][];
  crafting: CraftingItem[];
  /** [summoning slab item id, boss name, ultra?] */
  raids: [string, string, number][];
  /** EPalRelicType short name -> effigies needed for each successive Statue of Power rank */
  statueRanks: Record<string, number[]>;
  /** [research id, name, category, work amount needed] */
  research: [string, string, string, number][];
  /** [skin id, name, paid DLC?] */
  skins: [string, string, number][];
  /** Player level cap. */
  maxLevel: number;
  /** In-game map coordinates of the nine Pal Critics (which one is which area is unknown). */
  palCritics: [number, number][];
}

export interface CraftingRecipe {
  id: string;
  quantity: number;
  workAmount: number;
  sources: string[];
  ingredients: [string, string, number][];
}

export interface CraftingItem {
  id: string;
  name: string;
  rarity: number;
  group: string;
  icon: string;
  weight: number;
  baseValue: number;
  stackLimit: number;
  technologyLevels: number[];
  inheritedTechnologyLevels: number[];
  stats: [string, number][];
  recipes: CraftingRecipe[];
}

/** World-level (guild) progress that lives in Level.sav rather than the player save. */
export interface WorldProgress {
  /** Lab research work done per research id, one map per guild in the world. */
  labs: Record<string, number>[];
}

export type ItemState = 'done' | 'active' | 'todo';

export interface TrackedItem {
  id: string;
  name: string;
  /** Secondary text: level, step, capture count... */
  detail: string;
  state: ItemState;
  /** Sub-list the item belongs to (effigy type, boss kind), if the category has groups. */
  group: string;
  /** In-game map coordinates, "x, y", or '' for items without a place. */
  coords: string;
  /** Precise map position for rendering; coords is the rounded in-game readout. */
  position?: { x: number; y: number };
  /** Map the coordinates refer to; '' when it is the main one. */
  map: string;
  /** Sort key within the category (paldeck number, level, name). */
  order: number;
  /** Number shown in its own column (Paldeck number, technology tier), or null. */
  no: number | null;
  /** Maximum shown alongside the number for rank progress. */
  noMax?: number;
  /** Lifetime catches shown against the capture bonus target, without capping. */
  captureProgress?: { done: number; total: number };
  fishing?: { common: number; whopper: number; lunker: number };
  crafting?: CraftingItem & { count: number | null; sources: string[]; sourceLabel: string };
  /** False for rows shown for information only (paid DLC); they do not count. */
  counted?: boolean;
  /** Short label shown as a chip in its own column (Normal / Ultra). */
  tag?: string;
}

export interface TrackedGroup {
  key: string;
  name: string;
  done: number;
  total: number;
}

export interface Category {
  key: string;
  title: string;
  done: number;
  total: number;
  percent: number;
  items: TrackedItem[];
  groups: TrackedGroup[];
  /** Ids the save has that the master list does not know (old or renamed content). */
  unknown: string[];
  /** Items with real coordinates, so the list can offer them. */
  hasCoords: boolean;
  /** Items carry a number column. */
  hasNumbers: boolean;
  /** Header for the number column. */
  numberLabel: string;
  /** Items carry a tag chip column. */
  hasTags: boolean;
  /** Set when the category cannot be computed because this save file was not loaded. */
  needsFile?: string;
  unavailable?: string;
  /** Costs of all remaining technologies, independent of the visible list filters. */
  technologyPoints?: { key: string; name: string; remaining: number; available: number | null; needed: number | null }[];
}

export interface StatEntry {
  label: string;
  value: string;
  title: string;
}

export interface CompletionSummary {
  categories: Category[];
  /** Equal-weight mean of the category percentages. */
  percent: number;
  done: number;
  total: number;
  stats: StatEntry[];
}

/* ------------------------------------------------------------------ maps */

/** Unreal world units -> the coordinates the in-game map shows (checked against paldb.cc markers). */
export function worldToMap(x: number, y: number): { x: number; y: number } {
  const point = worldToMapExact(x, y);
  return { x: Math.round(point.x), y: Math.round(point.y) };
}

function worldToMapExact(x: number, y: number): { x: number; y: number } {
  // The World Tree has its own map readout (PalDB's separate tree map config).
  if (mapOf(x, y)) return { x: (y + 818197) / 1335.144531 - 127.7, y: (x - 347351.5) / 1335.144531 + 648.7 };
  return { x: (y - 157935) / 459, y: (x + 123930) / 459 };
}

const WORLD_TREE = { min: { x: 347351.5, y: -818197 }, max: { x: 689148.5, y: -476400 } };

/** '' for the Palpagos Islands map, otherwise the name of the other map. */
export function mapOf(x: number, y: number): string {
  const inside = x >= WORLD_TREE.min.x && x <= WORLD_TREE.max.x && y >= WORLD_TREE.min.y && y <= WORLD_TREE.max.y;
  return inside ? 'World Tree' : '';
}

function place(x: number, y: number): { coords: string; map: string; position?: { x: number; y: number } } {
  if (!x && !y) return { coords: '', map: '' };
  const point = worldToMap(x, y);
  return { coords: `${point.x}, ${point.y}`, map: mapOf(x, y), position: worldToMapExact(x, y) };
}

/* ------------------------------------------------------------ categories */

function percentOf(done: number, total: number): number {
  return total > 0 ? Math.round((done / total) * 1000) / 10 : 0;
}

const STATE_RANK: Record<ItemState, number> = { active: 0, todo: 1, done: 2 };

function finish(category: Omit<Category, 'done' | 'total' | 'percent' | 'hasCoords' | 'hasNumbers' | 'numberLabel' | 'hasTags'>, numberLabel = 'No.'): Category {
  const counted = category.items.filter((item) => item.counted !== false);
  const done = counted.filter((item) => item.state === 'done').length;
  const total = counted.length;
  const stateRank = category.key === 'crafting' ? { active: 0, todo: 0, done: 0 }
    : ['captureBonus', 'relics', 'statue'].includes(category.key) ? { active: 0, todo: 0, done: 1 } : STATE_RANK;
  category.items.sort((a, b) => stateRank[a.state] - stateRank[b.state] || a.order - b.order || a.name.localeCompare(b.name));
  return {
    ...category, done, total, percent: percentOf(done, total),
    hasCoords: category.items.some((item) => item.coords !== ''),
    hasNumbers: category.items.some((item) => item.no !== null),
    numberLabel,
    hasTags: category.items.some((item) => !!item.tag),
  };
}

function groupsOf(items: TrackedItem[], names: Map<string, string>): TrackedGroup[] {
  const groups: TrackedGroup[] = [];
  for (const [key, name] of names) {
    const members = items.filter((item) => item.group === key && item.counted !== false);
    if (!members.length) continue;
    groups.push({ key, name, done: members.filter((item) => item.state === 'done').length, total: members.length });
  }
  return groups;
}

function unknownIds(saveIds: Iterable<string>, known: Set<string>): string[] {
  return [...saveIds].filter((id) => !known.has(id)).sort();
}

/** Captures of one species that count toward its Paldeck capture bonus. */
const CAPTURE_BONUS_MAX = 5;

/** The save spells some ids differently from the game data (WereWolf vs Werewolf); match loosely. */
function lowerKeys<T>(entries: Record<string, T>): Map<string, T> {
  return new Map(Object.entries(entries).map(([key, value]) => [key.toLowerCase(), value]));
}

function paldeckCategory(record: PlayerCompletion, data: CompletionData): Category {
  const unlocked = new Set(record.paldeck.map((tribe) => tribe.toLowerCase()));
  const caughtBy = lowerKeys(record.capture_counts);
  const items: TrackedItem[] = data.paldeck.map(([tribe, index, name]) => {
    const key = tribe.toLowerCase();
    const done = unlocked.has(key);
    const caught = caughtBy.get(key) ?? 0;
    return { id: tribe, name, detail: done ? `caught ${caught}` : '', state: done ? 'done' : 'todo', group: '', coords: '', map: '', order: index, no: index };
  });
  const known = new Set(data.paldeck.map(([tribe]) => tribe.toLowerCase()));
  return finish({
    key: 'paldeck', title: 'Paldeck', items, groups: [],
    unknown: record.paldeck.filter((tribe) => !known.has(tribe.toLowerCase())).sort(),
  });
}

/** Catching several of each species fills the Paldeck capture bonus. */
function captureBonusCategory(record: PlayerCompletion, data: CompletionData): Category {
  const caughtBy = lowerKeys(record.capture_counts);
  const bonusBy = lowerKeys(record.capture_bonus_counts);
  const known = new Set(data.paldeck.map(([tribe]) => tribe.toLowerCase()));
  const fishingBy = new Map<string, NonNullable<TrackedItem['fishing']>>();
  const unknown: string[] = [];
  const fishingCounts = new Map<string, number>();
  for (const [id, count] of Object.entries(record.fishing_counts ?? {})) {
    if (Number.isFinite(count) && count > 0) {
      const key = id.toLowerCase();
      fishingCounts.set(key, Math.max(fishingCounts.get(key) ?? 0, count));
    }
  }
  for (const [id, count] of fishingCounts) {
    const match = /^fishshadow_(.+)_(common|boss|nushi)$/.exec(id);
    if (!match || !known.has(match[1])) {
      unknown.push(id);
      continue;
    }
    const fishing = fishingBy.get(match[1]) ?? { common: 0, whopper: 0, lunker: 0 };
    const kind = match[2] === 'common' ? 'common' : match[2] === 'boss' ? 'whopper' : 'lunker';
    fishing[kind] += count;
    fishingBy.set(match[1], fishing);
  }
  const items: TrackedItem[] = data.paldeck.map(([tribe, index, name]) => {
    const key = tribe.toLowerCase();
    const bonus = Math.min(CAPTURE_BONUS_MAX, bonusBy.get(key) ?? 0);
    const caught = caughtBy.get(key) ?? 0;
    let state: ItemState = 'todo';
    if (bonus >= CAPTURE_BONUS_MAX) state = 'done';
    else if (bonus > 0) state = 'active';
    return { id: tribe, name, detail: '', state, group: '', coords: '', map: '', order: index, no: index,
      captureProgress: { done: caught, total: CAPTURE_BONUS_MAX }, fishing: fishingBy.get(key) };
  });
  return finish({ key: 'captureBonus', title: 'Capture Bonus', items, groups: [], unknown: unknown.sort() });
}

function technologyCategory(record: PlayerCompletion, data: CompletionData): Category {
  const unlocked = new Set(record.technologies.map(id => id.toLowerCase()));
  const items: TrackedItem[] = data.technologies.map(([id, name, level, ancient, cost]) => ({
    id, name, detail: `${cost} ${ancient ? 'ancient technology' : 'technology'} ${cost === 1 ? 'point' : 'points'}`, state: unlocked.has(id.toLowerCase()) ? 'done' : 'todo', group: ancient ? 'ancient' : 'regular', coords: '', map: '', order: level, no: level,
  }));
  const technologyPoints = [0, 1].map(ancient => {
    const remaining = data.technologies.reduce((sum, [id, , , type, cost]) =>
      sum + (type === ancient && !unlocked.has(id.toLowerCase()) ? cost : 0), 0);
    const available = (ancient ? record.counters.boss_technology_points : record.counters.technology_points) ?? null;
    return {
      key: ancient ? 'ancient' : 'regular',
      name: ancient ? 'Ancient technology points' : 'Technology points', remaining, available,
      needed: remaining === 0 ? 0 : available === null ? null : Math.max(0, remaining - available),
    };
  });
  const names = new Map([['regular', 'Technology'], ['ancient', 'Ancient technology']]);
  const known = new Set(data.technologies.map(([id]) => id.toLowerCase()));
  return finish({
    key: 'technologies', title: 'Technologies', items, groups: groupsOf(items, names), technologyPoints,
    unknown: record.technologies.filter((id) => !known.has(id.toLowerCase())).sort(),
  }, 'Level');
}

function craftingSourceLabel(name: string, source: string): string {
  for (const [prefix, label] of [['Technology: ', 'Tech'], ['Ancient technology: ', 'Ancient tech']]) {
    if (source.startsWith(prefix)) {
      const technology = source.slice(prefix.length);
      return technology === name ? label : `${label}: ${technology}`;
    }
  }
  const prefix = `${name} `;
  if (source.startsWith(prefix)) {
    const suffix = source.slice(prefix.length);
    if (/^Schematic(?: \d+)?$/.test(suffix)) return suffix;
  }
  return source;
}

function craftingCategory(record: PlayerCompletion, data: CompletionData): Category {
  const counts = new Map<string, number>();
  for (const [id, count] of Object.entries(record.crafted_item_counts ?? {})) {
    if (Number.isFinite(count) && count >= 0) {
      const key = id.toLowerCase();
      counts.set(key, Math.max(counts.get(key) ?? 0, count));
    }
  }
  const catalog = data.crafting ?? [];
  const known = new Set(catalog.map(item => item.id.toLowerCase()));
  const items: TrackedItem[] = catalog.map(item => {
    const count = record.crafted_item_counts == null ? null : counts.get(item.id.toLowerCase()) ?? 0;
    const sources = [...new Set(item.recipes.flatMap(recipe => recipe.sources))];
    const levels = item.technologyLevels.length ? item.technologyLevels : item.inheritedTechnologyLevels;
    return {
      id: item.id, name: item.name, group: item.group, no: null, coords: '', map: '',
      order: levels.length ? Math.min(...levels) : Number.MAX_SAFE_INTEGER,
      state: count !== null && count > 0 ? 'done' : 'todo',
      detail: [...sources, ...item.recipes.flatMap(recipe => recipe.ingredients.map(([, name]) => name))].join(' · '),
      crafting: { ...item, count, sources, sourceLabel: sources.map(source => craftingSourceLabel(item.name, source)).join(' · ') },
    };
  });
  const groups = new Map([...new Set(catalog.map(item => item.group))].sort().map(name => [name, name]));
  return finish({ key: 'crafting', title: 'Crafting', items, groups: groupsOf(items, groups),
    unknown: [...counts].filter(([id, count]) => count > 0 && !known.has(id)).map(([id]) => id).sort(),
    unavailable: record.crafted_item_counts == null ? 'This save does not record crafting history.' : undefined,
  });
}

function relicCategory(record: PlayerCompletion, data: CompletionData): Category {
  const obtained = new Set<string>();
  for (const ids of Object.values(record.relics)) for (const id of ids) obtained.add(id);
  const names = new Map(data.relicTypes.map((type) => [type.key, type.item]));
  const items: TrackedItem[] = Object.entries(data.relics).map(([id, [typeIndex, x, y]]) => {
    const type = data.relicTypes[typeIndex];
    return {
      id, name: type?.item ?? 'Effigy', detail: type?.name ?? '', state: obtained.has(id) ? 'done' : 'todo',
      group: type?.key ?? '', ...place(x, y), order: typeIndex, no: null,
    };
  });
  const mimogIndex = data.relicTypes.findIndex(type => type.enum === 'MoveSpeed');
  const mimog = data.relicTypes[mimogIndex];
  if (mimog) {
    const bonusBy = lowerKeys(record.capture_bonus_counts);
    for (const [index, [tribe, , palName]] of data.paldeck.entries()) {
      const bonus = Math.min(CAPTURE_BONUS_MAX, bonusBy.get(tribe.toLowerCase()) ?? 0);
      items.push({
        id: `capture-bonus:${tribe}`, name: mimog.item,
        detail: `Capture ${CAPTURE_BONUS_MAX} ${palName} · ${bonus}/${CAPTURE_BONUS_MAX}`,
        state: bonus >= CAPTURE_BONUS_MAX ? 'done' : bonus > 0 ? 'active' : 'todo',
        group: mimog.key, coords: '', map: '', order: mimogIndex + index / (data.paldeck.length + 1), no: null,
      });
    }
  }
  return finish({
    key: 'relics', title: 'Pal Effigies', items,
    groups: groupsOf(items, names), unknown: unknownIds(obtained, new Set(Object.keys(data.relics))),
  });
}

/** Derive Statue of Power ranks from effigies earned minus those still held. */
function statueCategory(record: PlayerCompletion, data: CompletionData): Category {
  const items: TrackedItem[] = [];
  const captureEffigies = new Set(Object.entries(record.capture_bonus_counts)
    .filter(([, count]) => count >= CAPTURE_BONUS_MAX).map(([id]) => id.toLowerCase())).size;
  for (const [typeIndex, type] of data.relicTypes.entries()) {
    const perRank = data.statueRanks[type.enum];
    if (!perRank?.length) continue;
    const collected = type.enum === 'MoveSpeed' ? captureEffigies : record.relics[type.enum]?.length ?? 0;
    const held = record.relics_unspent[type.enum] ?? 0;
    const spent = Math.max(0, collected - held);
    let rank = 0;
    let cumulative = 0;
    for (const need of perRank) {
      if (spent < cumulative + need) break;
      cumulative += need;
      rank += 1;
    }
    const max = perRank.length;
    const toNext = rank < max ? cumulative + perRank[rank] - spent : 0;
    const parts: string[] = [];
    if (held) parts.push(`${held} held`);
    if (toNext) parts.push(`${toNext} more for next rank`);
    items.push({
      id: type.enum, name: type.name, detail: parts.join(' · '), state: rank >= max ? 'done' : rank > 0 ? 'active' : 'todo',
      group: '', coords: '', map: '', order: typeIndex, no: rank, noMax: max,
    });
  }
  return finish({ key: 'statue', title: 'Statue Of Power', items, groups: [], unknown: [] }, 'Rank');
}

function fastTravelCategory(record: PlayerCompletion, data: CompletionData): Category {
  const unlocked = new Set(record.fast_travel);
  const items: TrackedItem[] = Object.entries(data.fastTravel).map(([id, [name, x, y, , pointId, statue]]) => ({
    id, name, detail: pointId.startsWith('FTPoint') ? '' : pointId.replace(/_/g, ' '), state: unlocked.has(id) ? 'done' : 'todo',
    group: statue ? 'statue' : 'other', ...place(x, y), order: statue ? 0 : 1, no: null,
  }));
  const names = new Map([['statue', 'Great Eagle Statue'], ['other', 'Watchtower']]);
  return finish({
    key: 'fastTravel', title: 'Fast Travel', items, groups: groupsOf(items, names),
    unknown: unknownIds(record.fast_travel, new Set(Object.keys(data.fastTravel))),
  });
}

function noteCategory(record: PlayerCompletion, data: CompletionData): Category {
  const found = new Set(record.notes);
  const items: TrackedItem[] = Object.entries(data.notes).map(([id, [name, x, y]]) => ({
    id, name, detail: '', state: found.has(id) ? 'done' : 'todo', group: '', ...place(x, y), order: 0, no: null,
  }));
  return finish({
    key: 'notes', title: 'Journals', items, groups: [],
    unknown: unknownIds(record.notes, new Set(Object.keys(data.notes))),
  });
}

function questCategory(record: PlayerCompletion, data: CompletionData, kind: 'Main' | 'Sub'): Category {
  const completed = new Set(record.quests_completed.map(id => id.toLowerCase()));
  const active = new Map(record.quests_active.map((quest) => [quest.id.toLowerCase(), quest]));
  const claimed = {
    npc_achievements: new Set(record.npc_achievements.map(id => id.toLowerCase())),
    pal_display: new Set(record.pal_display.map(id => id.toLowerCase())),
  };
  const quests = Object.entries(data.quests).filter(([id, [type, , disabled]]) =>
    type === kind && !disabled && (kind !== 'Main' || !UNTRACKED_MAIN_QUESTS.has(id.toLowerCase())));
  const items: TrackedItem[] = [];
  // Several quests share a display name (the nine Pal Critic requests); add the part of
  // the id that tells them apart.
  const nameCounts = new Map<string, number>();
  for (const [, [, name]] of quests) {
    nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
  }
  for (const [id, [, baseName, , x, y]] of quests) {
    const key = id.toLowerCase();
    const areaMatch = /_([A-Z])_\d+$/.exec(id);
    const suffix = areaMatch ? `area ${areaMatch[1]}` : id.replace(/^(Main|Sub|Hidden)_/, '').replace(/_/g, ' ');
    const name = (nameCounts.get(baseName) ?? 0) > 1 ? `${baseName} (${suffix})` : baseName;
    let state: ItemState = 'todo';
    let detail = '';
    if (completed.has(key)) {
      state = 'done';
    } else if (active.has(key)) {
      state = 'active';
      const quest = active.get(key)!;
      const counters = Object.entries(quest.counters).filter(([key]) => !key.startsWith('CanCompleteFlag'));
      const progress = counters.map(([key, value]) => `${key.replace(/^QuestBlock_DeliveryItem_/, '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()} ${value}`);
      detail = ['in progress', quest.block > 0 ? `step ${quest.block + 1}` : '', ...progress].filter(Boolean).join(' · ');
    }
    const rewards = QUEST_REWARDS.get(key);
    if (rewards) {
      const done = rewards.ids.filter(flag => claimed[rewards.field].has(flag)).length;
      // A completed introductory/request quest does not prove all rewards were
      // claimed. Count each finite series from its persistent stage flags.
      state = done === rewards.ids.length ? 'done' : done > 0 || state !== 'todo' ? 'active' : 'todo';
      detail = `${done} / ${rewards.ids.length} rewards claimed`;
    }
    items.push({ id, name, detail, state, group: '', ...place(x, y), order: 0, no: null });
  }
  const known = new Set(Object.keys(data.quests).map(id => id.toLowerCase()));
  const key = kind === 'Main' ? 'mainQuests' : 'sideQuests';
  return finish({
    key, title: kind === 'Main' ? 'Main Missions' : 'Side Missions', items, groups: [], unknown: kind === 'Main' ? record.quests_completed.filter(id => !known.has(id.toLowerCase())).sort() : [],
  });
}

/** Main-boss flags with no Hard version (the pal table has GYM_*_2 hard variants for the other nine). */
const NO_HARD_MODE = new Set([
  'BOSS_BATTLE_NAME_KingWhaleBoss', 'BOSS_BATTLE_NAME_WorldTreeMiddleBoss1', 'BOSS_BATTLE_NAME_WorldTreeMiddleBoss2', 'BOSS_BATTLE_NAME_WorldTreeMiddleBoss3',
]);

function towerCategory(record: PlayerCompletion, data: CompletionData): Category {
  const beaten = new Set(record.tower_bosses);
  const items: TrackedItem[] = Object.entries(data.towers).map(([id, [name, x, y]]) => {
    const countKey = id.replace('BOSS_BATTLE_NAME_', '') + '_Normal';
    const count = record.tower_boss_counts[countKey];
    return {
      id, name, detail: count ? `defeated ${count}×` : '', state: beaten.has(id) ? 'done' : 'todo', group: '', ...place(x, y), order: 0, no: null,
    };
  });
  return finish({
    key: 'towers', title: 'Bosses', items, groups: [],
    unknown: unknownIds(record.tower_bosses, new Set(Object.keys(data.towers))),
  });
}

/** Bosses beaten on Hard: the eight towers and the final World Tree boss. */
function towerHardCategory(record: PlayerCompletion, data: CompletionData): Category {
  const items: TrackedItem[] = Object.entries(data.towers)
    .filter(([id]) => !NO_HARD_MODE.has(id))
    .map(([id, [name, x, y]]) => {
      const count = record.tower_boss_counts[id.replace('BOSS_BATTLE_NAME_', '') + '_Hard'] ?? 0;
      return { id: `${id}_Hard`, name, detail: count ? `defeated ${count}×` : '', state: count > 0 ? 'done' : 'todo', group: '', ...place(x, y), order: 0, no: null };
    });
  return finish({ key: 'towersHard', title: 'Bosses (Hard)', items, groups: [], unknown: [] });
}

function raidCategory(record: PlayerCompletion, data: CompletionData): Category {
  const items: TrackedItem[] = data.raids.map(([id, name, ultra]) => {
    const count = record.raid_boss_counts[id] ?? 0;
    return { id, name, detail: count ? `defeated ${count}×` : '', state: count > 0 ? 'done' : 'todo', group: ultra ? 'ultra' : 'normal', coords: '', map: '', order: ultra, no: null, tag: ultra ? 'Ultra' : 'Normal' };
  });
  const known = new Set(data.raids.map(([id]) => id));
  return finish({
    key: 'raids', title: 'Raid Bosses', items, groups: [],
    unknown: Object.keys(record.raid_boss_counts).filter((id) => !known.has(id)).sort(),
  });
}

function bossCategory(record: PlayerCompletion, data: CompletionData, kinds: string[], key: string, title: string): Category {
  // Spawner ids are Unreal FNames, which compare case-insensitively; the save may spell
  // them differently from the level data (BOSS_Police_old vs BOSS_Police_Old).
  const beaten = new Set(record.bosses.map((spawner) => spawner.toLowerCase()));
  const items: TrackedItem[] = [];
  const seen = new Set<string>();
  for (const [spawner, name, level, kind, x, y] of data.bosses) {
    const lower = spawner.toLowerCase();
    if (!kinds.includes(kind) || seen.has(lower)) continue;
    seen.add(lower);
    items.push({
      id: spawner, name, detail: '', state: beaten.has(lower) ? 'done' : 'todo',
      group: kind, ...place(x, y), order: level, no: level || null,
    });
  }
  const allKnown = new Set(data.bosses.map(([spawner]) => spawner.toLowerCase()));
  // Only report ids that no boss list knows, and only once (on the alpha category).
  const unknown = key === 'alphas' ? record.bosses.filter((spawner) => !allKnown.has(spawner.toLowerCase())).sort() : [];
  return finish({ key, title, items, groups: [], unknown }, 'LVL');
}

function areaCategory(record: PlayerCompletion, data: CompletionData): Category {
  const found = new Set(record.areas.map((area) => area.toLowerCase()));
  const items: TrackedItem[] = Object.entries(data.areas).map(([id, [name, x, y]]) => ({
    id, name, detail: '', state: found.has(id.toLowerCase()) ? 'done' : 'todo', group: '', ...place(x, y), order: x || y ? 0 : 1, no: null,
  }));
  const known = new Set(Object.keys(data.areas).map((id) => id.toLowerCase()));
  return finish({
    key: 'areas', title: 'Regions', items, groups: [],
    unknown: record.areas.filter((area) => !known.has(area.toLowerCase())).sort(),
  });
}

function ruinCategory(record: PlayerCompletion, data: CompletionData): Category {
  const taken = new Set(record.item_pickups);
  const items: TrackedItem[] = Object.entries(data.ruinPickups).map(([id, [x, y, , itemName]]) => ({
    id, name: itemName || 'Ruin pickup', detail: itemName ? '' : 'contents unknown', state: taken.has(id) ? 'done' : 'todo',
    group: '', ...place(x, y), order: itemName ? 0 : 1, no: null,
  }));
  return finish({
    key: 'ruins', title: 'Ruin Pickups', items, groups: [],
    unknown: unknownIds(record.item_pickups, new Set(Object.keys(data.ruinPickups))),
  });
}

/**
 * Guild lab research. Level.sav keeps work done per research id for each guild; with
 * several guilds the most advanced one is shown.
 *
 * TODO: once the app ships work-suitability / element icons, show the research category
 * (Cool, EmitFlame, Watering...) as its icon instead of text, in the chips and the rows.
 */
function researchCategory(world: WorldProgress | undefined, data: CompletionData): Category {
  const labs = world?.labs ?? [];
  if (!labs.length) {
    return {
      key: 'research', title: 'Lab Research', done: 0, total: data.research.length, percent: 0, items: [], groups: [],
      unknown: [], hasCoords: false, hasNumbers: false, numberLabel: '', hasTags: false, needsFile: 'Level.sav',
    };
  }
  const names = new Map<string, string>([
    ['Handcraft', 'Handiwork'],
    ['EmitFlame', 'Kindling'],
    ['Watering', 'Watering'],
    ['Seeding', 'Planting'],
    ['GenerateElectricity', 'Generating Electricity'],
    ['Deforest', 'Lumbering'],
    ['Mining', 'Mining'],
    ['Cool', 'Cooling'],
    ['ProductMedicine', 'Medicine Production'],
  ]);
  for (const [, , category] of data.research) if (category && !names.has(category)) names.set(category, category.replace(/([a-z])([A-Z])/g, '$1 $2'));
  const build = (lab: Record<string, number>): Category => {
    const items: TrackedItem[] = data.research.map(([id, name, category, work]) => {
      const done = lab[id] ?? 0;
      let state: ItemState = 'todo';
      if (work > 0 && done >= work - 0.5) state = 'done';
      else if (done > 0) state = 'active';
      // The same research name recurs in every work category, so the category is the detail.
      const detail = [names.get(category) ?? category, state === 'active' ? `${Math.round((done / work) * 100)}% researched` : ''].filter(Boolean).join(' · ');
      return { id, name, detail, state, group: category, coords: '', map: '', order: 0, no: null };
    });
    return finish({ key: 'research', title: 'Lab Research', items, groups: groupsOf(items, names), unknown: [] });
  };
  return labs.map(build).sort((a, b) => b.done - a.done)[0];
}

/** Pal skins. Paid DLC skins are listed but not counted. */
function skinCategory(record: PlayerCompletion, data: CompletionData): Category {
  const owned = new Set(record.skins);
  const items: TrackedItem[] = data.skins.map(([id, name, paid]) => ({
    id, name, detail: paid ? 'paid DLC · not counted' : '', state: owned.has(id) ? 'done' : 'todo',
    group: '', coords: '', map: '', order: paid, no: null, counted: !paid,
  }));
  return finish({ key: 'skins', title: 'Pal Skins', items, groups: [], unknown: record.skins.filter((id) => !data.skins.some(([known]) => known === id)).sort() });
}

/* --------------------------------------------------------------- summary */

function stat(label: string, value: number | null | undefined, title: string): StatEntry | null {
  if (value === null || value === undefined) return null;
  return { label, value: value.toLocaleString(), title };
}

export function summarize(record: PlayerCompletion, data: CompletionData, world?: WorldProgress): CompletionSummary {
  const categories = [
    paldeckCategory(record, data),
    captureBonusCategory(record, data),
    relicCategory(record, data),
    statueCategory(record, data),
    towerCategory(record, data),
    towerHardCategory(record, data),
    raidCategory(record, data),
    bossCategory(record, data, ['alpha', 'boss'], 'alphas', 'Alpha Pals'),
    bossCategory(record, data, ['bounty'], 'bounties', 'Bounty Targets'),
    questCategory(record, data, 'Main'),
    questCategory(record, data, 'Sub'),
    noteCategory(record, data),
    fastTravelCategory(record, data),
    areaCategory(record, data),
    ruinCategory(record, data),
    technologyCategory(record, data),
    craftingCategory(record, data),
    researchCategory(world, data),
    skinCategory(record, data),
  ];
  const counted = categories.filter((category) => category.total > 0 && !category.needsFile && !category.unavailable);
  const percent = counted.length ? Math.round((counted.reduce((sum, category) => sum + category.percent, 0) / counted.length) * 10) / 10 : 0;
  const done = categories.reduce((sum, category) => sum + category.done, 0);
  const total = categories.reduce((sum, category) => sum + category.total, 0);
  const counters = record.counters;
  const stats = [
    stat('Dungeons', counters.normal_dungeon_clears, 'Random dungeons cleared'),
    stat('Fixed dungeons', counters.fixed_dungeon_clears, 'Fixed (story) dungeons cleared'),
    stat('Oil rigs', counters.oilrig_clears, 'Oil rig raids cleared'),
    stat('Camps', counters.camps_conquered, 'Syndicate camps conquered'),
    stat('Treasures', counters.treasures_found, 'Treasure map spots dug up'),
    stat('Predators', counters.predator_defeats, 'Predator pals defeated'),
    stat('Mutations', counters.mutations, 'Mutated pals bred'),
    stat('4-star pals', record.rankup_counts['5'] ?? null, 'Pals condensed to the maximum star rank'),
    stat('Unspent effigies', counters.relics_unspent, 'Effigies not yet offered at a Statue of Power'),
  ].filter((entry): entry is StatEntry => entry !== null);
  return { categories, percent, done, total, stats };
}
