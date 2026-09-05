/**
 * Turns one player's completion record plus the bundled master lists into per-category
 * progress. Pure functions, no Angular, so they can be checked under Node.
 */
import type { PlayerCompletion } from '../../backend';

/** Shape of resources/completion/completion-data.json (built by Paltest/build_completion_data.py). */
export interface CompletionData {
  generated: string;
  sources: Record<string, string>;
  relicTypes: { key: string; enum: string; name: string; item: string; pal: string }[];
  /** level object id -> [relic type index, x, y, z] */
  relics: Record<string, [number, number, number, number]>;
  /** level object id -> [name, x, y, z, point id] */
  fastTravel: Record<string, [string, number, number, number, string]>;
  /** note id -> [name, x, y, z] */
  notes: Record<string, [string, number, number, number]>;
  /** quest id -> [Main|Sub|Hidden, name, disabled?] */
  quests: Record<string, [string, string, number?]>;
  /** [spawner id, name, level, alpha|boss|bounty, x, y, z] */
  bosses: [string, string, number, string, number, number, number][];
  /** tower flag -> [name, x, y, z] */
  towers: Record<string, [string, number, number, number]>;
  /** area id -> name */
  areas: Record<string, string>;
  /** level object id -> [x, y, z] */
  ruinPickups: Record<string, [number, number, number]>;
  /** [tribe id, paldeck number, name] */
  paldeck: [string, number, string][];
  /** [technology id, name, required level, ancient (boss) technology?] */
  technologies: [string, string, number, number][];
  /** [summoning slab item id, boss name, ultra?] */
  raids: [string, string, number][];
}

export type ItemState = 'done' | 'active' | 'todo';

export interface TrackedItem {
  id: string;
  name: string;
  /** Secondary text: level, step, capture count… */
  detail: string;
  state: ItemState;
  /** Sub-list the item belongs to (effigy type, boss kind), if the category has groups. */
  group: string;
  /** In-game map coordinates, "x, y", or '' for items without a place. */
  coords: string;
  /** Map the coordinates refer to; '' when it is the main one. */
  map: string;
  /** Sort key within the category (paldeck number, level, name). */
  order: number;
  /** Number shown in its own column (Paldeck number, technology tier), or null. */
  no: number | null;
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

/** Unreal world units -> the coordinates the in-game map shows. */
export function worldToMap(x: number, y: number): { x: number; y: number } {
  return { x: Math.round((y - 157935) / 459), y: -Math.round((x + 123930) / 459) };
}

const WORLD_TREE = { min: { x: 347351.5, y: -818197 }, max: { x: 689148.5, y: -476400 } };

/** '' for the Palpagos Islands map, otherwise the name of the other map. */
export function mapOf(x: number, y: number): string {
  const inside = x >= WORLD_TREE.min.x && x <= WORLD_TREE.max.x && y >= WORLD_TREE.min.y && y <= WORLD_TREE.max.y;
  return inside ? 'World Tree' : '';
}

function place(x: number, y: number): { coords: string; map: string } {
  if (!x && !y) return { coords: '', map: '' };
  const point = worldToMap(x, y);
  return { coords: `${point.x}, ${point.y}`, map: mapOf(x, y) };
}

/* ------------------------------------------------------------ categories */

function percentOf(done: number, total: number): number {
  return total > 0 ? Math.round((done / total) * 1000) / 10 : 0;
}

const STATE_RANK: Record<ItemState, number> = { active: 0, todo: 1, done: 2 };

function finish(category: Omit<Category, 'done' | 'total' | 'percent' | 'hasCoords' | 'hasNumbers' | 'numberLabel'>, numberLabel = 'No.'): Category {
  const done = category.items.filter((item) => item.state === 'done').length;
  const total = category.items.length;
  // In progress first, then missing, then done; within a state by the category's own order.
  category.items.sort((a, b) => STATE_RANK[a.state] - STATE_RANK[b.state] || a.order - b.order || a.name.localeCompare(b.name));
  return {
    ...category, done, total, percent: percentOf(done, total),
    hasCoords: category.items.some((item) => item.coords !== ''),
    hasNumbers: category.items.some((item) => item.no !== null),
    numberLabel,
  };
}

function groupsOf(items: TrackedItem[], names: Map<string, string>): TrackedGroup[] {
  const groups: TrackedGroup[] = [];
  for (const [key, name] of names) {
    const members = items.filter((item) => item.group === key);
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
  const items: TrackedItem[] = data.paldeck.map(([tribe, index, name]) => {
    const key = tribe.toLowerCase();
    const bonus = Math.min(CAPTURE_BONUS_MAX, bonusBy.get(key) ?? 0);
    const caught = caughtBy.get(key) ?? 0;
    let state: ItemState = 'todo';
    if (bonus >= CAPTURE_BONUS_MAX) state = 'done';
    else if (bonus > 0) state = 'active';
    return { id: tribe, name, detail: `caught ${caught} / ${CAPTURE_BONUS_MAX}`, state, group: '', coords: '', map: '', order: index, no: index };
  });
  return finish({ key: 'captureBonus', title: 'Capture bonus', items, groups: [], unknown: [] });
}

function technologyCategory(record: PlayerCompletion, data: CompletionData): Category {
  const unlocked = new Set(record.technologies);
  const items: TrackedItem[] = data.technologies.map(([id, name, level, ancient]) => ({
    id, name, detail: '', state: unlocked.has(id) ? 'done' : 'todo', group: ancient ? 'ancient' : 'regular', coords: '', map: '', order: level, no: level,
  }));
  const names = new Map([['regular', 'Technology'], ['ancient', 'Ancient technology']]);
  const known = new Set(data.technologies.map(([id]) => id));
  return finish({
    key: 'technologies', title: 'Technologies', items, groups: groupsOf(items, names),
    unknown: record.technologies.filter((id) => !known.has(id)).sort(),
  }, 'Level');
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
  return finish({
    key: 'relics', title: 'Pal Effigies', items,
    groups: groupsOf(items, names), unknown: unknownIds(obtained, new Set(Object.keys(data.relics))),
  });
}

function fastTravelCategory(record: PlayerCompletion, data: CompletionData): Category {
  const unlocked = new Set(record.fast_travel);
  const items: TrackedItem[] = Object.entries(data.fastTravel).map(([id, [name, x, y, , pointId]]) => ({
    id, name, detail: pointId.startsWith('FTPoint') ? '' : pointId.replace(/_/g, ' '), state: unlocked.has(id) ? 'done' : 'todo',
    group: '', ...place(x, y), order: 0, no: null,
  }));
  return finish({
    key: 'fastTravel', title: 'Fast travel', items, groups: [],
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
  const completed = new Set(record.quests_completed);
  const active = new Map(record.quests_active.map((quest) => [quest.id, quest]));
  const items: TrackedItem[] = [];
  for (const [id, [type, name, disabled]] of Object.entries(data.quests)) {
    if (type !== kind || disabled) continue;
    let state: ItemState = 'todo';
    let detail = '';
    if (completed.has(id)) {
      state = 'done';
    } else if (active.has(id)) {
      state = 'active';
      const quest = active.get(id)!;
      const counters = Object.entries(quest.counters).filter(([key]) => !key.startsWith('CanCompleteFlag'));
      const progress = counters.map(([key, value]) => `${key.replace(/^QuestBlock_DeliveryItem_/, '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()} ${value}`);
      detail = ['in progress', quest.block > 0 ? `step ${quest.block + 1}` : '', ...progress].filter(Boolean).join(' · ');
    }
    items.push({ id, name, detail, state, group: '', coords: '', map: '', order: 0, no: null });
  }
  const known = new Set(Object.keys(data.quests));
  const key = kind === 'Main' ? 'mainQuests' : 'sideQuests';
  return finish({
    key, title: kind === 'Main' ? 'Main missions' : 'Side missions', items, groups: [], unknown: kind === 'Main' ? unknownIds(record.quests_completed, known) : [],
  });
}

/** Tower flags the save records that are not real towers (no Hard mode). */
const EXTRA_TOWER_FLAGS = new Set([
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
    key: 'towers', title: 'Tower bosses', items, groups: [],
    unknown: unknownIds(record.tower_bosses, new Set(Object.keys(data.towers))),
  });
}

/** Tower bosses beaten on Hard; only the eight real towers offer that difficulty. */
function towerHardCategory(record: PlayerCompletion, data: CompletionData): Category {
  const items: TrackedItem[] = Object.entries(data.towers)
    .filter(([id]) => !EXTRA_TOWER_FLAGS.has(id))
    .map(([id, [name, x, y]]) => {
      const count = record.tower_boss_counts[id.replace('BOSS_BATTLE_NAME_', '') + '_Hard'] ?? 0;
      return { id: `${id}_Hard`, name, detail: count ? `defeated ${count}×` : '', state: count > 0 ? 'done' : 'todo', group: '', ...place(x, y), order: 0, no: null };
    });
  return finish({ key: 'towersHard', title: 'Tower bosses (Hard)', items, groups: [], unknown: [] });
}

function raidCategory(record: PlayerCompletion, data: CompletionData): Category {
  const items: TrackedItem[] = data.raids.map(([id, name, ultra]) => {
    const count = record.raid_boss_counts[id] ?? 0;
    return { id, name, detail: count ? `defeated ${count}×` : '', state: count > 0 ? 'done' : 'todo', group: ultra ? 'ultra' : 'normal', coords: '', map: '', order: ultra, no: null };
  });
  const names = new Map([['normal', 'Normal'], ['ultra', 'Ultra']]);
  const known = new Set(data.raids.map(([id]) => id));
  return finish({
    key: 'raids', title: 'Raid bosses', items, groups: groupsOf(items, names),
    unknown: Object.keys(record.raid_boss_counts).filter((id) => !known.has(id)).sort(),
  });
}

function bossCategory(record: PlayerCompletion, data: CompletionData, kinds: string[], key: string, title: string): Category {
  const beaten = new Set(record.bosses);
  const items: TrackedItem[] = [];
  const seen = new Set<string>();
  for (const [spawner, name, level, kind, x, y] of data.bosses) {
    if (!kinds.includes(kind) || seen.has(spawner)) continue;
    seen.add(spawner);
    items.push({
      id: spawner, name, detail: level ? `Lv. ${level}` : '', state: beaten.has(spawner) ? 'done' : 'todo',
      group: kind, ...place(x, y), order: level, no: null,
    });
  }
  const known = new Set(data.bosses.filter(([, , , kind]) => kinds.includes(kind)).map(([spawner]) => spawner));
  const allKnown = new Set(data.bosses.map(([spawner]) => spawner));
  // Only report ids that no boss list knows, and only once (on the alpha category).
  const unknown = key === 'alphas' ? unknownIds(record.bosses, allKnown) : [];
  void known;
  return finish({ key, title, items, groups: [], unknown });
}

function areaCategory(record: PlayerCompletion, data: CompletionData): Category {
  const found = new Set(record.areas.map((area) => area.toLowerCase()));
  const items: TrackedItem[] = Object.entries(data.areas).map(([id, name]) => ({
    id, name, detail: '', state: found.has(id.toLowerCase()) ? 'done' : 'todo', group: '', coords: '', map: '', order: 0, no: null,
  }));
  const known = new Set(Object.keys(data.areas).map((id) => id.toLowerCase()));
  return finish({
    key: 'areas', title: 'Regions', items, groups: [],
    unknown: record.areas.filter((area) => !known.has(area.toLowerCase())).sort(),
  });
}

function ruinCategory(record: PlayerCompletion, data: CompletionData): Category {
  const taken = new Set(record.item_pickups);
  const items: TrackedItem[] = Object.entries(data.ruinPickups).map(([id, [x, y]]) => ({
    id, name: 'Ruin pickup', detail: '', state: taken.has(id) ? 'done' : 'todo', group: '', ...place(x, y), order: 0, no: null,
  }));
  return finish({
    key: 'ruins', title: 'Ruin pickups', items, groups: [],
    unknown: unknownIds(record.item_pickups, new Set(Object.keys(data.ruinPickups))),
  });
}

/* --------------------------------------------------------------- summary */

function stat(label: string, value: number | null | undefined, title: string): StatEntry | null {
  if (value === null || value === undefined) return null;
  return { label, value: value.toLocaleString(), title };
}

export function summarize(record: PlayerCompletion, data: CompletionData): CompletionSummary {
  const categories = [
    paldeckCategory(record, data),
    captureBonusCategory(record, data),
    relicCategory(record, data),
    towerCategory(record, data),
    towerHardCategory(record, data),
    raidCategory(record, data),
    bossCategory(record, data, ['alpha', 'boss'], 'alphas', 'Alpha Pals'),
    bossCategory(record, data, ['bounty'], 'bounties', 'Bounty targets'),
    questCategory(record, data, 'Main'),
    questCategory(record, data, 'Sub'),
    noteCategory(record, data),
    fastTravelCategory(record, data),
    areaCategory(record, data),
    ruinCategory(record, data),
    technologyCategory(record, data),
  ];
  const counted = categories.filter((category) => category.total > 0);
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
    stat('Captures', counters.tribe_captures, 'Distinct pal species captured'),
    stat('Skins', record.skins.length, 'Pal skins owned'),
    stat('Unspent effigies', counters.relics_unspent, 'Effigies not yet offered at a Statue of Power'),
  ].filter((entry): entry is StatEntry => entry !== null);
  return { categories, percent, done, total, stats };
}
