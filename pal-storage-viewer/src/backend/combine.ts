/**
 * Merge parsed save files into one pal table with a location per pal.
 */
import { PlayerCompletion } from './completion';
import { PropertyValue } from './gvas';
import { ELEMENT_NAMES, Lookups, WORK_COLUMN_KEYS, WORK_NAMES } from './lookups';
import { finalStat, researchBonus } from './stats';
import { PalRecord } from './record';
import { BaseCamp, ParsedFile, SaveKind } from './saves';

export type Row = Record<string, string | number | boolean | null>;

export interface CombineEntry {
  /** Stable identity of the file, used for caching by the caller. */
  key: string;
  name: string;
  /** Save-set label, usually the folder the file came from. */
  set: string;
  /** Letter assigned by the page so it stays put across reloads. */
  letter: string;
  parsed: ParsedFile | { error: string };
}

export interface SaveSource {
  file: string;
  set: string;
  kind: SaveKind;
  kind_label: string;
  pals: number;
  note: string;
  class_name?: string;
  saved_at?: string;
  total_slots?: number;
  players?: number;
  bases?: number;
  skipped?: { players: number; wild_or_npc: number; unreadable: number };
  player_uid?: string | null;
  /** A player save that carries the completion record (bosses, effigies, journals…). */
  has_completion?: boolean;
  world_name?: string;
  host_player_name?: string;
  host_player_level?: number | null;
  in_game_day?: number | null;
}

export interface SaveSetSummary {
  label: string;
  letter: string;
  folder: string;
  world_name: string;
  host_player_name: string;
  in_game_day: number | null;
  saved_at: string;
  pals: number;
  bases: { index: number; location: { x: number; y: number; z: number } | null; workers: number }[];
  players: { uid: string; name: string; level: number | null; completion: PlayerCompletion | null }[];
  /** Guild lab research progress from Level.sav, one map per guild. */
  labs: Record<string, number>[];
  has_level: boolean;
  has_dimensional_storage: boolean;
}

export interface CombinedSaves {
  rows: Row[];
  sources: SaveSource[];
  sets: SaveSetSummary[];
}

const PAL_BOX_PAGE_SIZE = 30;

export const SOURCE_KIND_LABELS: Record<SaveKind, string> = {
  dimensional_storage: 'Dimensional storage',
  level: 'World (Level.sav)',
  player: 'Player',
  level_meta: 'World info',
  world_option: 'World options',
  local_data: 'Local data',
  unknown: 'Unknown',
};

interface SaveSet {
  label: string;
  letter: string;
  world_name: string;
  host_player_name: string;
  in_game_day: number | null;
  saved_at: string;
  players: Set<string>;
  player_names: Map<string, string>;
  player_levels: Map<string, number | null>;
  completions: Map<string, PlayerCompletion>;
  labs: Record<string, number>[];
  party_containers: Set<string>;
  pal_box_containers: Set<string>;
  base_containers: Map<string, BaseCamp>;
  bases: BaseCamp[];
  containers: Record<string, { slots: number; occupied: number }>;
  dps_records: PalRecord[];
  level_records: PalRecord[];
}

/** Whole-number text with round-half-to-even. */
function fixed0(value: number): string {
  const floor = Math.floor(value);
  const diff = value - floor;
  let rounded: number;
  if (diff > 0.5) rounded = floor + 1;
  else if (diff < 0.5) rounded = floor;
  else rounded = floor % 2 === 0 ? floor : floor + 1;
  return Object.is(rounded, -0) || rounded === 0 && value < 0 ? '-0' : String(rounded);
}

function locateLevelRecord(record: PalRecord, set: SaveSet): [string, string] {
  const containerId = record.pal_box.container_id;
  const slot = record.pal_box.slot_index;
  const hasSlot = typeof slot === 'number' && slot >= 0;
  const slotLabel = hasSlot ? `slot ${slot + 1}` : '';
  const pageLabel = () => (hasSlot ? `page ${Math.floor(slot / PAL_BOX_PAGE_SIZE) + 1}, slot ${slot % PAL_BOX_PAGE_SIZE + 1}` : '');
  if (containerId === null) return ['Unknown', ''];
  if (set.party_containers.has(containerId)) return ['Party', slotLabel];
  if (set.pal_box_containers.has(containerId)) return ['Pal Box', pageLabel()];
  const base = set.base_containers.get(containerId);
  if (base) {
    const loc = base.location;
    const where = loc ? `x ${fixed0(loc.x)}, y ${fixed0(loc.y)}` : '';
    return [`Base ${base.index}`, [slotLabel, where].filter(Boolean).join(', ')];
  }
  const info = set.containers[containerId];
  if (info) {
    // No player save for this owner: guess from the container size.
    if (info.slots <= 5) return ['Party', slotLabel];
    return ['Pal Box', pageLabel()];
  }
  return ['Other container', slotLabel];
}

/** 1 -> A, 26 -> Z, 27 -> AA. */
export function saveLetter(ordinal: number): string {
  let letters = '';
  while (ordinal > 0) {
    const remainder = (ordinal - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    ordinal = Math.floor((ordinal - 1) / 26);
  }
  return letters;
}

/**
 * Short, distinct labels for each save set. Starts from the world name; only saves that
 * would read the same (typical for backups of one world) get the in-game day, then the
 * save time, then the folder name added, and only those saves.
 */
function saveDisplayNames(sets: Map<string, SaveSet>): Map<string, string> {
  const folderTail = (folder: string) => (folder ? folder.replace(/\/+$/, '').split('/').pop() ?? '' : '');
  const ordinals = new Map<string, number>();
  let n = 1;
  for (const label of sets.keys()) ordinals.set(label, n++);
  const baseName = (label: string, set: SaveSet) => set.world_name || folderTail(label) || `Save ${ordinals.get(label)}`;
  const level = (label: string, set: SaveSet, depth: number) => {
    const base = baseName(label, set);
    const parts = [base];
    if (depth >= 1 && set.in_game_day !== null) parts.push(`day ${set.in_game_day}`);
    if (depth >= 2 && set.saved_at) parts.push(set.saved_at.replace('T', ' ').slice(0, 16));
    const tail = folderTail(label);
    if (depth >= 3 && tail && tail !== base) parts.push(tail);
    if (depth >= 4 && label && label !== tail) parts.push(label);
    return parts.join(' · ');
  };
  const depths = new Map<string, number>();
  const names = new Map<string, string>();
  for (const [label, set] of sets) {
    depths.set(label, 0);
    names.set(label, level(label, set, 0));
  }
  for (let round = 0; round < 5; round++) {
    const counts = new Map<string, number>();
    for (const name of names.values()) counts.set(name, (counts.get(name) ?? 0) + 1);
    const clashing = [...names].filter(([label, name]) => (counts.get(name) ?? 0) > 1 && (depths.get(label) ?? 0) < 4).map(([label]) => label);
    if (!clashing.length) break;
    for (const label of clashing) {
      const depth = (depths.get(label) ?? 0) + 1;
      depths.set(label, depth);
      names.set(label, level(label, sets.get(label)!, depth));
    }
  }
  const seen = new Map<string, number>();
  for (const [label, name] of [...names]) {
    const count = (seen.get(name) ?? 0) + 1;
    seen.set(name, count);
    if (count > 1) names.set(label, `${name} (${count})`);
  }
  return names;
}

function applyParsedFile(parsed: ParsedFile, source: SaveSource, set: SaveSet): void {
  source.kind = parsed.kind;
  source.class_name = parsed.class_name;
  source.saved_at = parsed.saved_at;
  // Level.sav is the authoritative world clock; other files only fill a gap.
  if (parsed.saved_at && (parsed.kind === 'level' || !set.saved_at)) set.saved_at = parsed.saved_at;
  if (parsed.kind === 'dimensional_storage') {
    set.dps_records.push(...parsed.payload.records);
    source.pals = parsed.payload.occupied_slots;
    source.total_slots = parsed.payload.total_storage_slots;
  } else if (parsed.kind === 'level') {
    set.level_records.push(...parsed.payload.records);
    set.bases.push(...parsed.payload.bases);
    set.labs.push(...parsed.payload.labs);
    Object.assign(set.containers, parsed.payload.containers);
    for (const base of parsed.payload.bases) {
      if (base.worker_container_id) set.base_containers.set(base.worker_container_id, base);
    }
    for (const player of parsed.payload.players) {
      if (player.player_uid) {
        set.player_names.set(player.player_uid, player.name ?? '');
        set.player_levels.set(player.player_uid, player.level);
      }
    }
    source.pals = parsed.payload.records.length;
    source.players = parsed.payload.players.length;
    source.bases = parsed.payload.bases.length;
    source.skipped = parsed.payload.skipped;
  } else if (parsed.kind === 'player') {
    if (parsed.payload.party_container_id) set.party_containers.add(parsed.payload.party_container_id);
    if (parsed.payload.pal_box_container_id) set.pal_box_containers.add(parsed.payload.pal_box_container_id);
    if (parsed.payload.player_uid) set.players.add(parsed.payload.player_uid);
    if (parsed.payload.player_uid && parsed.payload.completion) set.completions.set(parsed.payload.player_uid, parsed.payload.completion);
    source.player_uid = parsed.payload.player_uid;
    source.has_completion = parsed.payload.completion !== null;
  } else if (parsed.kind === 'level_meta') {
    set.world_name = parsed.payload.world_name || '';
    set.host_player_name = parsed.payload.host_player_name || '';
    set.in_game_day = parsed.payload.in_game_day;
    Object.assign(source, parsed.payload);
  } else {
    source.note = 'Contains no pals; ignored.';
  }
}

/** Merge the given parsed files; files that share a `set` resolve each other's container ids. */
export function combineSaves(entries: CombineEntry[], lookups?: Lookups): CombinedSaves {
  const sets = new Map<string, SaveSet>();
  const sources: SaveSource[] = [];
  const recordSource = new Map<PalRecord, SaveSource>();

  const getSet = (label: string, letter: string): SaveSet => {
    let set = sets.get(label);
    if (!set) {
      set = {
        label, letter: '', world_name: '', host_player_name: '', in_game_day: null, saved_at: '',
        players: new Set(), player_names: new Map(), player_levels: new Map(), completions: new Map(), labs: [], party_containers: new Set(), pal_box_containers: new Set(),
        base_containers: new Map(), bases: [], containers: {}, dps_records: [], level_records: [],
      };
      sets.set(label, set);
    }
    if (letter && !set.letter) set.letter = letter;
    return set;
  };

  for (const entry of entries) {
    const set = getSet(entry.set || '', entry.letter || '');
    const source: SaveSource = { file: entry.name, set: set.label, kind: 'unknown', kind_label: '', pals: 0, note: '' };
    sources.push(source);
    if ('error' in entry.parsed) {
      source.note = `Could not decode: ${entry.parsed.error}`;
      continue;
    }
    applyParsedFile(entry.parsed, source, set);
    if (entry.parsed.kind === 'dimensional_storage' || entry.parsed.kind === 'level') {
      for (const record of entry.parsed.payload.records) recordSource.set(record, source);
    }
  }

  const rows: Row[] = [];
  const summaries: SaveSetSummary[] = [];
  const displays = saveDisplayNames(sets);
  let ordinal = 0;
  for (const [label, set] of sets) {
    ordinal += 1;
    const display = displays.get(label) ?? label;
    const letter = set.letter || saveLetter(ordinal);
    for (const record of set.level_records) {
      const [location, detail] = locateLevelRecord(record, set);
      record.placement = { location, detail };
    }
    for (const record of set.dps_records) {
      const slot = record.storage_index;
      record.placement = { location: 'DimsPS', detail: `page ${Math.floor(slot / PAL_BOX_PAGE_SIZE) + 1}, slot ${slot % PAL_BOX_PAGE_SIZE + 1}` };
    }
    for (const record of [...set.level_records, ...set.dps_records]) {
      const owner = record.ownership.owner_player_uid;
      const source = recordSource.get(record)!;
      record.owner_name = owner ? set.player_names.get(owner) ?? '' : '';
      record.save = display;
      record.save_id = letter;
      record.source_file = source.file;
      record.source_kind = SOURCE_KIND_LABELS[source.kind] ?? source.kind;
      rows.push(flattenRecord(record));
    }
    // "Base Pal Enhancement" research raises attack/defense of every Pal working at a base.
    const research = lookups ? researchBonus(set.labs, lookups) : null;
    if (research && (research.attack || research.defense)) {
      for (const row of rows) {
        if (row['save_id'] !== letter || typeof row['location'] !== 'string' || !row['location'].startsWith('Base')) continue;
        row['research_attack_pct'] = research.attack;
        row['research_defense_pct'] = research.defense;
        row['research_items'] = research.items.join('; ');
        if (typeof row['attack_base'] === 'number') row['attack'] = finalStat(row['attack_base'], [Number(row['passive_attack_pct']) || 0, Number(row['food_attack_pct']) || 0, research.attack]);
        if (typeof row['defense_base'] === 'number') row['defense'] = finalStat(row['defense_base'], [Number(row['passive_defense_pct']) || 0, Number(row['food_defense_pct']) || 0, research.defense]);
      }
    }
    const playerIds = new Set<string>([...set.players, ...set.player_names.keys()]);
    summaries.push({
      label: display,
      letter,
      folder: label,
      world_name: set.world_name,
      host_player_name: set.host_player_name,
      in_game_day: set.in_game_day,
      saved_at: set.saved_at,
      pals: set.level_records.length + set.dps_records.length,
      bases: set.bases.map((base) => ({
        index: base.index,
        location: base.location ?? null,
        workers: set.level_records.filter((record) => record.pal_box.container_id === base.worker_container_id).length,
      })),
      players: [...playerIds].sort().map((uid) => ({ uid, name: set.player_names.get(uid) ?? '', level: set.player_levels.get(uid) ?? null, completion: set.completions.get(uid) ?? null })),
      labs: set.labs,
      has_level: set.level_records.length > 0 || sources.some((source) => source.kind === 'level' && source.set === label),
      has_dimensional_storage: sources.some((source) => source.kind === 'dimensional_storage' && source.set === label),
    });
  }
  for (const source of sources) source.kind_label = SOURCE_KIND_LABELS[source.kind] ?? source.kind;
  return { rows, sources, sets: summaries };
}

/* ---------------------------------------------------------------- flatten */

type Cell = string | number | boolean | null;

function cell(value: PropertyValue | undefined): Cell {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Uint8Array) return `bytes[${value.length}]`;
  return JSON.stringify(value);
}

function text(value: PropertyValue | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return JSON.stringify(value);
}

function joinValues(values: (PropertyValue | undefined)[]): string {
  return values.filter((value) => value !== null && value !== undefined).map(text).join(', ');
}

function joinPairs(mapping: Record<string, PropertyValue> | undefined): string {
  return Object.entries(mapping ?? {}).map(([key, value]) => `${key}=${text(value)}`).join(', ');
}

function joinItems(items: PropertyValue[] | undefined): string {
  return (items ?? []).map((item) => {
    if (item && typeof item === 'object' && !Array.isArray(item) && !(item instanceof Uint8Array)) {
      return Object.entries(item).map(([key, value]) => `${key}=${text(value)}`).join('/');
    }
    return text(item);
  }).join(', ');
}

export function flattenRecord(item: PalRecord): Row {
  const restore = item.arena.restore;
  const jumped = item.location.last_jumped;
  return {
    storage_slot: item.storage_index,
    save_id: item.save_id ?? null,
    location: item.placement?.location ?? null,
    location_detail: item.placement?.detail ?? null,
    save: item.save ?? null,
    source_file: item.source_file ?? null,
    source_kind: item.source_kind ?? null,
    owner_name: item.owner_name ?? null,
    pal_box_slot_index: cell(item.pal_box.slot_index),
    instance_id: item.identity.instance_id,
    pal_name: item.pal_name,
    pal_variant: item.pal_variant,
    species_id: item.species_id,
    species_base_id: item.species_base_id,
    unique_npc_id: item.unique_npc_id,
    gender: item.gender,
    elements: item.elements.map((index) => ELEMENT_NAMES[index] ?? '').filter(Boolean).join(', '),
    work: item.work_ranks.map((rank, index) => (rank > 0 ? `${WORK_NAMES[index]} ${rank}` : '')).filter(Boolean).join(', '),
    work_bonus: item.work_bonus_ranks.map((bonus, index) => (bonus > 0 ? `${WORK_NAMES[index]} ${bonus}` : '')).filter(Boolean).join(', '),
    ...Object.fromEntries(WORK_COLUMN_KEYS.map((key, index) => [key, item.work_ranks[index] ?? 0])),
    nickname: item.nickname,
    filtered_nickname: item.filtered_nickname,
    level: item.level,
    exp: item.exp,
    rank: item.rank,
    rank_up_exp: item.rank_up_exp,
    unused_status_points: item.unused_status_points,
    hp: item.needs.hp,
    shield_hp: item.needs.shield_hp,
    iv_hp: item.ivs.hp,
    iv_attack: item.ivs.attack,
    iv_defense: item.ivs.defense,
    soul_rank_hp: item.soul_ranks.hp,
    soul_rank_attack: item.soul_ranks.attack,
    soul_rank_defense: item.soul_ranks.defense,
    soul_rank_craft_speed: item.soul_ranks.craft_speed,
    max_hp: item.derived.max_hp,
    attack: item.derived.attack,
    defense: item.derived.defense,
    work_speed: item.derived.work_speed,
    max_hp_base: item.derived.max_hp_base,
    attack_base: item.derived.attack_base,
    defense_base: item.derived.defense_base,
    trust_hp: item.derived.trust_hp,
    trust_attack: item.derived.trust_attack,
    trust_defense: item.derived.trust_defense,
    food_effect: item.derived.food_effect,
    food_attack_pct: item.derived.food_attack_pct,
    food_defense_pct: item.derived.food_defense_pct,
    food_work_speed_pct: item.derived.food_work_speed_pct,
    food_seconds_left: item.derived.food_seconds_left,
    research_attack_pct: 0,
    research_defense_pct: 0,
    research_items: '',
    passive_hp_pct: item.derived.passive_hp_pct,
    passive_attack_pct: item.derived.passive_attack_pct,
    passive_defense_pct: item.derived.passive_defense_pct,
    passive_work_speed_pct: item.derived.passive_work_speed_pct,
    hunger_max: item.derived.hunger_max,
    trust_rank: item.derived.trust_rank,
    trust_progress: item.derived.trust_progress,
    trust_next: item.derived.trust_next,
    exp_to_next: item.derived.exp_to_next,
    exp_progress: item.derived.exp_progress,
    partner_skill: item.derived.partner_skill,
    partner_skill_level: item.derived.partner_skill_level,
    partner_skill_text: item.derived.partner_skill_text,
    food_amount: item.derived.food_amount,
    known_skill_ids: joinValues(item.derived.known_skill_ids),
    known_moves: joinValues(item.derived.known_moves),
    skills: joinValues(item.skills),
    skill_colors: joinValues(item.skill_colors),
    skill_ranks: joinValues(item.skill_ranks),
    passive_skill_ids: joinValues(item.passive_skill_ids),
    combat_moves: joinValues(item.combat_moves),
    active_skill_ids: joinValues(item.active_skill_ids),
    learned_moves: joinValues(item.learned_moves),
    mastered_skill_ids: joinValues(item.mastered_skill_ids),
    full_stomach: item.needs.full_stomach,
    sanity: item.needs.sanity,
    hunger_type: item.needs.hunger_type,
    physical_health: item.needs.physical_health,
    worker_sick: item.needs.worker_sick,
    is_lucky: item.flags['is_lucky'],
    is_awakening: item.flags['is_awakening'],
    is_player: item.flags['is_player'],
    favorite_index: item.favorite_index,
    voice_id: item.voice_id,
    skin_name: item.skin_name,
    allow_base_camp_battle: item.flags['allow_base_camp_battle'],
    applied_death_penalty: item.flags['applied_death_penalty'],
    apply_shield_damage: item.flags['apply_shield_damage'],
    enable_player_respawn_in_hardcore: item.flags['enable_player_respawn_in_hardcore'],
    favorite_changed_by_friendship: item.flags['favorite_changed_by_friendship'],
    disable_sale_in_pal_lost: item.flags['disable_sale_in_pal_lost'],
    excluded_from_team_mission: item.flags['excluded_from_team_mission'],
    imported_character: item.flags['imported_character'],
    friendship_points: item.friendship.points,
    friendship_otomo_seconds: item.friendship.otomo_seconds,
    friendship_active_otomo_seconds: item.friendship.active_otomo_seconds,
    friendship_basecamp_seconds: item.friendship.basecamp_seconds,
    owned_time: item.ownership.owned_time,
    owner_player_uid: item.ownership.owner_player_uid,
    last_nickname_modifier_player_uid: item.ownership.last_nickname_modifier_player_uid,
    arena_rank_points: item.arena.rank_points,
    pal_revive_timer: item.timers.pal_revive,
    partner_skill_cooldown_max: item.timers.partner_skill_cooldown_max,
    food_with_status_effect_timer: item.timers.food_with_status_effect,
    food_with_full_stomach_keep_timer: item.timers.food_with_full_stomach_keep,
    food_status_effect_item: item.food.status_effect_item,
    food_full_stomach_keep_item: item.food.full_stomach_keep_item,
    current_work_suitability: item.work.current_suitability,
    last_jumped_x: jumped?.x ?? null,
    last_jumped_y: jumped?.y ?? null,
    last_jumped_z: jumped?.z ?? null,
    exp_table_migration_version: item.migration.exp_table_version,
    instance_player_uid: item.identity.instance_player_uid,
    instance_debug_name: item.identity.debug_name,
    old_owner_player_uids: joinValues(item.ownership.old_owner_player_uids),
    pal_box_container_id: item.pal_box.container_id,
    item_container_id: item.item_container_id,
    base_camp_worker_event_type: item.base_camp_event.type,
    base_camp_worker_event_progress_time: item.base_camp_event.progress_time,
    got_status_points: joinPairs(item.status_points.got),
    got_ex_status_points: joinPairs(item.status_points.got_ex),
    food_regene_item_id: cell(item.food_regene.item_id),
    food_regene_effect_time: cell(item.food_regene.effect_time),
    food_regene_remaining_time: cell(item.food_regene.remaining_time),
    food_regene_effect_parameters: joinItems(item.food_regene.effect_parameters),
    off_work_suitability_list: joinValues(item.work.off_suitability_list),
    work_suitability_add_ranks: joinItems(item.work.add_ranks),
    work_suitability_overflow_ranks: joinItems(item.work.overflow_granted_ranks),
    skin_applied_character_id: item.skin_applied_character_id,
    expedition_map_object_instance_id: item.expedition_map_object_instance_id,
    partner_skill_last_used_time: item.timers.partner_skill_last_used_time,
    arena_restore_valid: cell(restore.valid),
    arena_restore_hp: cell(restore.hp),
    arena_restore_full_stomach: cell(restore.full_stomach),
    arena_restore_sanity: cell(restore.sanity),
    arena_restore_worker_sick: cell(restore.worker_sick),
    arena_restore_food_status_effect_item: cell(restore.food_status_effect_item),
    arena_restore_food_status_effect_timer: cell(restore.food_status_effect_timer),
    arena_restore_food_regene_item_id: cell(restore.food_regene.item_id),
    arena_restore_food_regene_effect_time: cell(restore.food_regene.effect_time),
    arena_restore_food_regene_remaining_time: cell(restore.food_regene.remaining_time),
    arena_restore_food_full_stomach_keep_item: cell(restore.food_full_stomach_keep_item),
    arena_restore_food_full_stomach_keep_timer: cell(restore.food_full_stomach_keep_timer),
    raw_property_names: joinValues(item.raw_property_names),
  };
}

