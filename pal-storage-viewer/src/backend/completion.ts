/**
 * Completion record of one player: what `Players/<uid>.sav` remembers about bosses,
 * effigies, journals, fast travel points, Paldeck entries and quests.
 *
 * The save only lists what was obtained (every flag is true); the totals come from the
 * static game data bundled with the site (resources/completion/completion-data.json).
 */
import { PropertyValue, SaveBuffer, findPropertyStart, readFString, readInt, readPropertyValue, readTagHeader } from './gvas';

export interface ActiveQuest {
  id: string;
  /** Step of a multi-step quest the player is on. */
  block: number;
  /** Progress counters such as DeliveredCount. */
  counters: Record<string, number>;
}

export interface CompletionCounters {
  predator_defeats: number | null;
  tribe_captures: number | null;
  normal_dungeon_clears: number | null;
  fixed_dungeon_clears: number | null;
  oilrig_clears: number | null;
  camps_conquered: number | null;
  treasures_found: number | null;
  mutations: number | null;
  relics_unspent: number | null;
  technology_points: number | null;
  boss_technology_points: number | null;
  unlocked_recipes: number | null;
}

export interface PlayerCompletion {
  tower_bosses: string[];
  tower_boss_counts: Record<string, number>;
  bosses: string[];
  raid_boss_counts: Record<string, number>;
  paldeck: string[];
  capture_counts: Record<string, number>;
  capture_bonus_counts: Record<string, number>;
  /** EPalRelicType short name -> obtained level-object ids (32 hex chars, upper case). */
  relics: Record<string, string[]>;
  relics_unspent: Record<string, number>;
  notes: string[];
  item_pickups: string[];
  fast_travel: string[];
  areas: string[];
  area_barriers: string[];
  world_maps: string[];
  npc_achievements: string[];
  pal_display: string[];
  quests_completed: string[];
  quests_active: ActiveQuest[];
  skins: string[];
  /** Unlocked technology ids (UnlockedRecipeTechnologyNames). */
  technologies: string[];
  counters: CompletionCounters;
}

type Scalar = string | number | boolean;

/** Layout after a MapProperty tag header: key type, value type, flag, remove count, count. */
function mapBody(buf: SaveBuffer, tagOffset: number): { keyType: string; valueType: string; first: number; count: number; end: number } | null {
  const tag = readTagHeader(buf, tagOffset);
  if (tag.type !== 'MapProperty') return null;
  const [keyType, afterKey] = readFString(buf, tag.offset);
  const [valueType, afterValue] = readFString(buf, afterKey);
  const at = afterValue + 1;
  return { keyType, valueType, first: at + 8, count: buf.i32(at + 4), end: at + tag.size };
}

function readScalar(buf: SaveBuffer, type: string, at: number, end: number): [Scalar | null, number] {
  switch (type) {
    case 'BoolProperty':
      return [buf.bytes[at] !== 0, at + 1];
    case 'IntProperty':
      return [buf.i32(at), at + 4];
    case 'Int64Property':
      return [buf.i64(at), at + 8];
    case 'FloatProperty':
      return [buf.f32(at), at + 4];
    case 'DoubleProperty':
      return [buf.f64(at), at + 8];
    case 'NameProperty':
    case 'StrProperty':
    case 'EnumProperty': {
      const [value, next] = readFString(buf, at, end);
      return [value, next];
    }
    default:
      return [null, -1];
  }
}

/**
 * Entries of a map whose keys and values are plain scalars (Name/Enum/Str keys with
 * Bool/Int/Name values). Maps with struct keys or values yield nothing.
 */
function readScalarMapAt(buf: SaveBuffer, tagOffset: number): [string, Scalar][] {
  if (tagOffset === -1) return [];
  try {
    const body = mapBody(buf, tagOffset);
    if (!body) return [];
    const entries: [string, Scalar][] = [];
    let at = body.first;
    for (let i = 0; i < body.count && at < body.end; i++) {
      const [key, afterKey] = readScalar(buf, body.keyType, at, body.end);
      if (afterKey === -1 || typeof key !== 'string') return entries;
      const [value, afterValue] = readScalar(buf, body.valueType, afterKey, body.end);
      if (afterValue === -1 || value === null) return entries;
      entries.push([key, value]);
      at = afterValue;
    }
    return entries;
  } catch {
    return [];
  }
}

function readScalarMap(buf: SaveBuffer, label: string): [string, Scalar][] {
  return readScalarMapAt(buf, findPropertyStart(buf, label));
}

/** Keys whose value is true. */
function trueKeys(entries: [string, Scalar][]): string[] {
  return entries.filter(([, value]) => value === true).map(([key]) => key);
}

function numbers(entries: [string, Scalar][], stripPrefix = ''): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [key, value] of entries) {
    if (typeof value !== 'number') continue;
    result[stripPrefix && key.startsWith(stripPrefix) ? key.slice(stripPrefix.length) : key] = value;
  }
  return result;
}

/** Offset just past a MapProperty tag at `offset`. */
function skipMap(buf: SaveBuffer, offset: number): number {
  const tag = readTagHeader(buf, offset);
  const [, afterKey] = readFString(buf, tag.offset);
  const [, afterValue] = readFString(buf, afterKey);
  return afterValue + 1 + tag.size;
}

/**
 * Property list where MapProperty members are decoded as scalar maps instead of being
 * skipped (the generic reader drops them). Returns [fields, offset after the terminator].
 */
function readPropertyListWithMaps(buf: SaveBuffer, offset: number, end: number): [Record<string, PropertyValue | [string, Scalar][]>, number] {
  const fields: Record<string, PropertyValue | [string, Scalar][]> = {};
  while (offset < end) {
    const tag = readTagHeader(buf, offset, end);
    if (tag.name === 'None') return [fields, tag.offset];
    if (tag.type === 'MapProperty') {
      fields[tag.name] = readScalarMapAt(buf, offset);
      offset = skipMap(buf, offset);
      continue;
    }
    const [name, value, next] = readPropertyValue(buf, offset);
    if (name === null || next <= offset) return [fields, next];
    fields[name] = value;
    offset = next;
  }
  return [fields, offset];
}

/** Elements of an ArrayProperty of structs, with nested scalar maps decoded. */
function readStructArrayWithMaps(buf: SaveBuffer, label: string): Record<string, PropertyValue | [string, Scalar][]>[] {
  const offset = findPropertyStart(buf, label);
  if (offset === -1) return [];
  try {
    const tag = readTagHeader(buf, offset);
    if (tag.type !== 'ArrayProperty') return [];
    const [innerType, afterInner] = readFString(buf, tag.offset);
    if (innerType !== 'StructProperty') return [];
    let at = afterInner + 1;
    const end = at + tag.size;
    const count = buf.i32(at);
    at += 4;
    // Array header: element name, "StructProperty", size, struct type, guid + flag.
    const [, afterName] = readFString(buf, at);
    const [, afterType] = readFString(buf, afterName);
    const [, afterStruct] = readFString(buf, afterType + 8);
    at = afterStruct + 17;
    const items: Record<string, PropertyValue | [string, Scalar][]>[] = [];
    for (let i = 0; i < count && at < end; i++) {
      const [fields, next] = readPropertyListWithMaps(buf, at, end);
      items.push(fields);
      if (next <= at) break;
      at = next;
    }
    return items;
  } catch {
    return [];
  }
}

/** Strings of an ArrayProperty of NameProperty (no element cap). */
function readNameList(buf: SaveBuffer, label: string): string[] {
  const offset = findPropertyStart(buf, label);
  if (offset === -1) return [];
  try {
    const tag = readTagHeader(buf, offset);
    if (tag.type !== 'ArrayProperty') return [];
    const [innerType, afterInner] = readFString(buf, tag.offset);
    if (innerType !== 'NameProperty' && innerType !== 'StrProperty') return [];
    let at = afterInner + 1;
    const end = at + tag.size;
    const count = buf.i32(at);
    at += 4;
    const values: string[] = [];
    for (let i = 0; i < count && at < end; i++) {
      const [value, next] = readFString(buf, at, end);
      values.push(value);
      at = next;
    }
    return values;
  } catch {
    return [];
  }
}

function readIntAt(buf: SaveBuffer, label: string): number | null {
  return readInt(buf, findPropertyStart(buf, label));
}

function shortEnum(value: PropertyValue | [string, Scalar][] | undefined): string {
  if (typeof value !== 'string') return '';
  const index = value.indexOf('::');
  return index === -1 ? value : value.slice(index + 2);
}

function asMap(value: PropertyValue | [string, Scalar][] | undefined): [string, Scalar][] {
  return Array.isArray(value) && value.every((entry) => Array.isArray(entry) && entry.length === 2) ? value as [string, Scalar][] : [];
}

/** True when the buffer holds a player save with a completion record. */
export function hasCompletionRecord(buf: SaveBuffer): boolean {
  return findPropertyStart(buf, 'RecordData') !== -1;
}

export function extractPlayerCompletion(buf: SaveBuffer): PlayerCompletion | null {
  if (!hasCompletionRecord(buf)) return null;

  // Effigies: the per-type array is authoritative; the flat map only covers the first type.
  const relics: Record<string, string[]> = {};
  for (const item of readStructArrayWithMaps(buf, 'RelicObtainForInstanceFlagByType')) {
    const type = shortEnum(item['Type']);
    if (!type) continue;
    relics[type] = trueKeys(asMap(item['Flags']));
  }
  if (!Object.keys(relics).length) {
    const legacy = trueKeys(readScalarMap(buf, 'RelicObtainForInstanceFlag'));
    if (legacy.length) relics['CapturePower'] = legacy;
  }

  const active: ActiveQuest[] = [];
  for (const item of readStructArrayWithMaps(buf, 'OrderedQuestArray_FullRelease')) {
    const id = item['QuestName'];
    if (typeof id !== 'string' || !id) continue;
    active.push({
      id,
      block: typeof item['BlockIndex'] === 'number' ? item['BlockIndex'] : 0,
      counters: numbers(asMap(item['IntegerMap'])),
    });
  }

  const relicsUnspent = numbers(readScalarMap(buf, 'RelicPossessNumMap'), 'EPalRelicType::');
  const technologies = readNameList(buf, 'UnlockedRecipeTechnologyNames');
  return {
    tower_bosses: trueKeys(readScalarMap(buf, 'TowerBossDefeatFlag')),
    tower_boss_counts: numbers(readScalarMap(buf, 'TowerBossDefeatCount')),
    bosses: trueKeys(readScalarMap(buf, 'NormalBossDefeatFlag')),
    raid_boss_counts: numbers(readScalarMap(buf, 'RaidBossDefeatCount')),
    paldeck: trueKeys(readScalarMap(buf, 'PaldeckUnlockFlag')),
    capture_counts: numbers(readScalarMap(buf, 'PalCaptureCount')),
    capture_bonus_counts: numbers(readScalarMap(buf, 'PalCaptureBonusCount')),
    relics,
    relics_unspent: relicsUnspent,
    notes: trueKeys(readScalarMap(buf, 'NoteObtainForInstanceFlag')),
    item_pickups: trueKeys(readScalarMap(buf, 'ItemPickupObtainForInstanceFlag')),
    fast_travel: trueKeys(readScalarMap(buf, 'FastTravelPointUnlockFlag')),
    areas: trueKeys(readScalarMap(buf, 'FindAreaFlagMap')),
    area_barriers: trueKeys(readScalarMap(buf, 'AreaBarrierUnlockFlags')),
    world_maps: trueKeys(readScalarMap(buf, 'UnlockedWorldMapFlags')),
    npc_achievements: trueKeys(readScalarMap(buf, 'NPCAchivementRewardFlag')),
    pal_display: trueKeys(readScalarMap(buf, 'PalDisplayNPCDataTableProgress')),
    quests_completed: readNameList(buf, 'CompletedQuestArray_FullRelease'),
    quests_active: active,
    skins: readStructArrayWithMaps(buf, 'InGameData')
      .map((item) => item['SkinName'])
      .filter((name): name is string => typeof name === 'string' && name !== ''),
    technologies,
    counters: {
      predator_defeats: readIntAt(buf, 'PredatorDefeatCount'),
      tribe_captures: readIntAt(buf, 'TribeCaptureCount'),
      normal_dungeon_clears: readIntAt(buf, 'NormalDungeonClearCount'),
      fixed_dungeon_clears: readIntAt(buf, 'FixedDungeonClearCount'),
      oilrig_clears: readIntAt(buf, 'OilrigClearCount'),
      camps_conquered: readIntAt(buf, 'CampConqueredCount'),
      treasures_found: readIntAt(buf, 'FoundTreasureCount'),
      mutations: readIntAt(buf, 'MutationCount'),
      relics_unspent: Object.values(relicsUnspent).reduce((sum, value) => sum + value, 0),
      technology_points: readIntAt(buf, 'TechnologyPoint'),
      boss_technology_points: readIntAt(buf, 'bossTechnologyPoint'),
      unlocked_recipes: technologies.length,
    },
  };
}
