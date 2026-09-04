import type { PalStorageRow } from '../save-parser.service';

/**
 * Filtering is built on one small model shared by three front ends: quick
 * toggle chips, the visual rule builder, and the text query syntax. Every
 * front end reads and writes the same `FilterGroup` tree, so anything that can
 * be expressed in one can be shown and edited in the others.
 */

export type FieldKind = 'text' | 'number' | 'boolean' | 'list';

export interface FilterField {
  /** Canonical key used inside the tree and as the first query alias. */
  key: string;
  label: string;
  group: string;
  kind: FieldKind;
  /** Names accepted by the query syntax; `key` is always accepted too. */
  aliases: string[];
  /** Offer values seen in the loaded data as suggestions. */
  suggest?: boolean;
  /** Short hint shown in the builder. */
  hint?: string;
  get: (row: PalStorageRow) => unknown;
}

export type Operator =
  | 'contains' | 'not_contains' | 'is' | 'is_not' | 'starts' | 'not_starts' | 'regex' | 'not_regex'
  | 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'between' | 'not_between'
  | 'has_any' | 'has_all' | 'has_none' | 'not_has_all'
  | 'is_true' | 'is_false'
  | 'empty' | 'not_empty';

export type OperatorArity = 'none' | 'one' | 'two' | 'many';

export interface OperatorDef {
  op: Operator;
  label: string;
  kinds: FieldKind[];
  arity: OperatorArity;
  negated: Operator;
}

export const OPERATORS: OperatorDef[] = [
  { op: 'contains', label: 'contains', kinds: ['text'], arity: 'many', negated: 'not_contains' },
  { op: 'not_contains', label: "doesn't contain", kinds: ['text'], arity: 'many', negated: 'contains' },
  { op: 'is', label: 'is', kinds: ['text'], arity: 'many', negated: 'is_not' },
  { op: 'is_not', label: 'is not', kinds: ['text'], arity: 'many', negated: 'is' },
  { op: 'starts', label: 'starts with', kinds: ['text'], arity: 'many', negated: 'not_starts' },
  { op: 'not_starts', label: "doesn't start with", kinds: ['text'], arity: 'many', negated: 'starts' },
  { op: 'regex', label: 'matches regex', kinds: ['text'], arity: 'one', negated: 'not_regex' },
  { op: 'not_regex', label: "doesn't match regex", kinds: ['text'], arity: 'one', negated: 'regex' },

  { op: 'eq', label: '=', kinds: ['number'], arity: 'many', negated: 'neq' },
  { op: 'neq', label: '≠', kinds: ['number'], arity: 'many', negated: 'eq' },
  { op: 'gt', label: '>', kinds: ['number'], arity: 'one', negated: 'lte' },
  { op: 'gte', label: '≥', kinds: ['number'], arity: 'one', negated: 'lt' },
  { op: 'lt', label: '<', kinds: ['number'], arity: 'one', negated: 'gte' },
  { op: 'lte', label: '≤', kinds: ['number'], arity: 'one', negated: 'gt' },
  { op: 'between', label: 'between', kinds: ['number'], arity: 'two', negated: 'not_between' },
  { op: 'not_between', label: 'not between', kinds: ['number'], arity: 'two', negated: 'between' },

  { op: 'has_any', label: 'has any of', kinds: ['list'], arity: 'many', negated: 'has_none' },
  { op: 'has_all', label: 'has all of', kinds: ['list'], arity: 'many', negated: 'not_has_all' },
  { op: 'has_none', label: 'has none of', kinds: ['list'], arity: 'many', negated: 'has_any' },
  { op: 'not_has_all', label: 'is missing any of', kinds: ['list'], arity: 'many', negated: 'has_all' },

  { op: 'is_true', label: 'yes', kinds: ['boolean'], arity: 'none', negated: 'is_false' },
  { op: 'is_false', label: 'no', kinds: ['boolean'], arity: 'none', negated: 'is_true' },

  { op: 'not_empty', label: 'is set', kinds: ['text', 'number', 'list'], arity: 'none', negated: 'empty' },
  { op: 'empty', label: 'is empty', kinds: ['text', 'number', 'list'], arity: 'none', negated: 'not_empty' }
];

const OPERATOR_INDEX = new Map(OPERATORS.map((def) => [def.op, def]));

export function operatorDef(op: Operator): OperatorDef {
  return OPERATOR_INDEX.get(op) ?? OPERATORS[0];
}

export function operatorsFor(kind: FieldKind): OperatorDef[] {
  return OPERATORS.filter((def) => def.kinds.includes(kind));
}

export function defaultOperator(kind: FieldKind): Operator {
  switch (kind) {
    case 'number': return 'gte';
    case 'boolean': return 'is_true';
    case 'list': return 'has_any';
    default: return 'contains';
  }
}

export interface FilterRule {
  type: 'rule';
  id: string;
  field: string;
  op: Operator;
  values: string[];
}

export interface FilterGroup {
  type: 'group';
  id: string;
  combinator: 'and' | 'or';
  negate: boolean;
  children: FilterNode[];
}

export type FilterNode = FilterRule | FilterGroup;

let nextId = 1;
export function newId(): string {
  return `f${nextId++}`;
}

export function createRule(field: string, op: Operator, values: string[] = []): FilterRule {
  return { type: 'rule', id: newId(), field, op, values };
}

export function createGroup(combinator: 'and' | 'or' = 'and', children: FilterNode[] = [], negate = false): FilterGroup {
  return { type: 'group', id: newId(), combinator, negate, children };
}

export function cloneNode<T extends FilterNode>(node: T): T {
  if (node.type === 'rule') {
    return { ...node, id: newId(), values: [...node.values] } as T;
  }
  return { ...node, id: newId(), children: node.children.map((child) => cloneNode(child)) } as T;
}

/** A rule that cannot narrow anything (no values yet) is treated as "always true". */
export function isRuleActive(rule: FilterRule): boolean {
  const arity = operatorDef(rule.op).arity;
  if (arity === 'none') return true;
  return rule.values.some((value) => value.trim() !== '');
}

export function isEmptyTree(node: FilterNode): boolean {
  if (node.type === 'rule') return !isRuleActive(node);
  return node.children.every((child) => isEmptyTree(child));
}

export function countActiveRules(node: FilterNode): number {
  if (node.type === 'rule') return isRuleActive(node) ? 1 : 0;
  return node.children.reduce((sum, child) => sum + countActiveRules(child), 0);
}

export function rulesEqual(left: FilterRule, right: FilterRule): boolean {
  return left.field === right.field
    && left.op === right.op
    && left.values.length === right.values.length
    && left.values.every((value, index) => value.toLowerCase() === right.values[index].toLowerCase());
}

/* ------------------------------------------------------------------------ */
/* Field registry                                                            */
/* ------------------------------------------------------------------------ */

function text(row: PalStorageRow, key: string): string {
  const value = row[key];
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}

function number(row: PalStorageRow, key: string): number | null {
  const value = row[key];
  if (typeof value === 'number') return value;
  const parsed = Number(text(row, key));
  return text(row, key).trim() !== '' && Number.isFinite(parsed) ? parsed : null;
}

function truthy(row: PalStorageRow, key: string): boolean {
  return /^(true|1|yes)$/i.test(text(row, key).trim());
}

export function splitList(value: string): string[] {
  return value.split(/\s*[;,]\s*/).map((item) => item.trim()).filter(Boolean);
}

function listCount(row: PalStorageRow, key: string): number {
  return splitList(text(row, key)).length;
}

function colorCount(row: PalStorageRow, color: string): number {
  return splitList(text(row, 'skill_colors')).filter((item) => item.toLowerCase() === color).length;
}

function ivs(row: PalStorageRow): number[] {
  return ['iv_hp', 'iv_attack', 'iv_defense']
    .map((key) => number(row, key))
    .filter((value): value is number => value !== null);
}

function displayRank(row: PalStorageRow): number | null {
  const stored = number(row, 'rank');
  return stored === null ? null : Math.max(0, Math.min(4, stored - 1));
}

const G = {
  pal: 'Pal',
  iv: 'IV',
  soul: 'Soul rank',
  passives: 'Passives',
  moves: 'Moves',
  condition: 'Condition',
  storage: 'Storage',
  other: 'Other'
};

export const ANY_FIELD = 'any';

export const KNOWN_FIELDS: FilterField[] = [
  {
    key: ANY_FIELD, label: 'Any text', group: G.pal, kind: 'text', aliases: ['text'],
    hint: 'Name, nickname, species, passives and moves',
    get: (row) => ['pal_name', 'nickname', 'species_id', 'skills', 'combat_moves', 'learned_moves']
      .map((key) => text(row, key)).filter(Boolean).join(' | ')
  },
  { key: 'pal', label: 'Pal name', group: G.pal, kind: 'text', aliases: ['name', 'pal_name'], suggest: true, get: (row) => text(row, 'pal_name') },
  { key: 'nick', label: 'Nickname', group: G.pal, kind: 'text', aliases: ['nickname'], get: (row) => text(row, 'nickname') },
  { key: 'no', label: 'Paldeck no.', group: G.pal, kind: 'number', aliases: ['dex', 'paldeck', 'paldeck_no'], get: (row) => number(row, 'paldeck_no') },
  { key: 'species', label: 'Species ID', group: G.pal, kind: 'text', aliases: ['species_id'], suggest: true, get: (row) => text(row, 'species_id') },
  { key: 'gender', label: 'Gender', group: G.pal, kind: 'text', aliases: ['sex'], suggest: true, get: (row) => text(row, 'gender') },
  { key: 'alpha', label: 'Alpha', group: G.pal, kind: 'boolean', aliases: ['boss', 'pal_variant'], get: (row) => text(row, 'pal_variant').toLowerCase() === 'alpha' },
  { key: 'lucky', label: 'Lucky', group: G.pal, kind: 'boolean', aliases: ['is_lucky'], get: (row) => truthy(row, 'is_lucky') },
  {
    key: 'favorite', label: 'Favorite', group: G.pal, kind: 'boolean', aliases: ['fav'],
    get: (row) => { const index = number(row, 'favorite_index'); return index !== null && index >= 1 && index <= 3; }
  },
  {
    key: 'fav_slot', label: 'Favorite slot', group: G.pal, kind: 'number', aliases: ['favorite_slot', 'favorite_index'],
    hint: 'Favorite marker I, II or III as 1, 2 or 3 (0 when not a favorite)',
    get: (row) => { const index = number(row, 'favorite_index'); return index !== null && index >= 1 && index <= 3 ? index : 0; }
  },
  { key: 'level', label: 'Level', group: G.pal, kind: 'number', aliases: ['lvl', 'lv'], get: (row) => number(row, 'level') },
  { key: 'rank', label: 'Rank (stars)', group: G.pal, kind: 'number', aliases: ['stars', 'star'], hint: '0 to 4', get: displayRank },

  { key: 'hp', label: 'IV HP', group: G.iv, kind: 'number', aliases: ['iv_hp', 'ivhp'], get: (row) => number(row, 'iv_hp') },
  { key: 'atk', label: 'IV Attack', group: G.iv, kind: 'number', aliases: ['attack', 'iv_attack', 'ivatk'], get: (row) => number(row, 'iv_attack') },
  { key: 'def', label: 'IV Defense', group: G.iv, kind: 'number', aliases: ['defense', 'iv_defense', 'ivdef'], get: (row) => number(row, 'iv_defense') },
  {
    key: 'iv', label: 'IV total', group: G.iv, kind: 'number', aliases: ['iv_total', 'ivtotal', 'ivsum'], hint: 'Sum of the three IVs',
    get: (row) => { const values = ivs(row); return values.length ? values.reduce((sum, value) => sum + value, 0) : null; }
  },
  {
    key: 'iv_min', label: 'IV lowest', group: G.iv, kind: 'number', aliases: ['ivmin'], hint: 'Weakest of the three IVs',
    get: (row) => { const values = ivs(row); return values.length ? Math.min(...values) : null; }
  },
  {
    key: 'iv_max', label: 'IV highest', group: G.iv, kind: 'number', aliases: ['ivmax'], hint: 'Best of the three IVs',
    get: (row) => { const values = ivs(row); return values.length ? Math.max(...values) : null; }
  },

  { key: 'sr_hp', label: 'Soul HP', group: G.soul, kind: 'number', aliases: ['soul_hp', 'soul_rank_hp'], get: (row) => number(row, 'soul_rank_hp') },
  { key: 'sr_atk', label: 'Soul Attack', group: G.soul, kind: 'number', aliases: ['soul_atk', 'soul_rank_attack'], get: (row) => number(row, 'soul_rank_attack') },
  { key: 'sr_def', label: 'Soul Defense', group: G.soul, kind: 'number', aliases: ['soul_def', 'soul_rank_defense'], get: (row) => number(row, 'soul_rank_defense') },
  {
    key: 'sr', label: 'SR total', group: G.soul, kind: 'number', aliases: ['sr_total', 'soul_total', 'soul'],
    hint: 'HP + Attack + Defense soul ranks (60 is max)',
    get: (row) => {
      const values = ['soul_rank_hp', 'soul_rank_attack', 'soul_rank_defense']
        .map((key) => number(row, key)).filter((value): value is number => value !== null);
      return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
    }
  },
  { key: 'sr_craft', label: 'Soul Crafting', group: G.soul, kind: 'number', aliases: ['soul_craft', 'soul_rank_craft_speed'], get: (row) => number(row, 'soul_rank_craft_speed') },

  { key: 'skills', label: 'Passive skills', group: G.passives, kind: 'list', aliases: ['skill', 'passive', 'passives', 'p'], suggest: true, get: (row) => text(row, 'skills') },
  { key: 'skill_count', label: 'Passive count', group: G.passives, kind: 'number', aliases: ['passives_count', 'skills_count'], get: (row) => listCount(row, 'skills') },
  { key: 'platinum', label: 'Platinum passives', group: G.passives, kind: 'number', aliases: ['plat', 'platinum_skills'], hint: 'Count of top tier passives', get: (row) => colorCount(row, 'platinum') },
  { key: 'gold', label: 'Gold passives', group: G.passives, kind: 'number', aliases: ['gold_skills'], hint: 'Count of gold tier passives', get: (row) => colorCount(row, 'gold') },
  { key: 'negative', label: 'Negative passives', group: G.passives, kind: 'number', aliases: ['bad', 'negative_skills'], hint: 'Count of negative passives', get: (row) => colorCount(row, 'negative') },
  { key: 'tiers', label: 'Passive tiers', group: G.passives, kind: 'list', aliases: ['skill_colors', 'colors'], suggest: true, get: (row) => text(row, 'skill_colors') },

  { key: 'moves', label: 'Active skills', group: G.moves, kind: 'list', aliases: ['move', 'active', 'combat_moves', 'equipped'], suggest: true, get: (row) => text(row, 'combat_moves') },
  { key: 'learned', label: 'Learned skills', group: G.moves, kind: 'list', aliases: ['learned_moves'], suggest: true, get: (row) => text(row, 'learned_moves') },
  { key: 'move_count', label: 'Active skill count', group: G.moves, kind: 'number', aliases: ['moves_count'], get: (row) => listCount(row, 'combat_moves') },
  { key: 'learned_count', label: 'Learned skill count', group: G.moves, kind: 'number', aliases: [], get: (row) => listCount(row, 'learned_moves') },

  { key: 'current_hp', label: 'Current HP', group: G.condition, kind: 'number', aliases: ['hp_now'], get: (row) => number(row, 'hp') },
  { key: 'stomach', label: 'Full stomach', group: G.condition, kind: 'number', aliases: ['full_stomach', 'hunger'], get: (row) => number(row, 'full_stomach') },
  { key: 'sanity', label: 'Sanity', group: G.condition, kind: 'number', aliases: [], get: (row) => number(row, 'sanity') },
  { key: 'health', label: 'Physical health', group: G.condition, kind: 'text', aliases: ['physical_health'], suggest: true, get: (row) => text(row, 'physical_health') },
  { key: 'hunger_type', label: 'Hunger type', group: G.condition, kind: 'text', aliases: [], suggest: true, get: (row) => text(row, 'hunger_type') },
  { key: 'sick', label: 'Worker sickness', group: G.condition, kind: 'text', aliases: ['worker_sick'], suggest: true, get: (row) => text(row, 'worker_sick') },
  { key: 'friendship', label: 'Friendship points', group: G.condition, kind: 'number', aliases: ['trust', 'friendship_points'], get: (row) => number(row, 'friendship_points') },
  { key: 'work', label: 'Current work', group: G.condition, kind: 'text', aliases: ['current_work_suitability', 'suitability'], suggest: true, get: (row) => text(row, 'current_work_suitability') },
  { key: 'exp', label: 'Experience', group: G.condition, kind: 'number', aliases: ['xp'], get: (row) => number(row, 'exp') },

  { key: 'slot', label: 'Storage page', group: G.storage, kind: 'number', aliases: ['storage_slot', 'box', 'page'], get: (row) => number(row, 'storage_slot') },
  { key: 'index', label: 'Pal Box slot index', group: G.storage, kind: 'number', aliases: ['pal_box_slot_index', 'slot_index', 'box_slot', 'ind'], get: (row) => number(row, 'pal_box_slot_index') },
  { key: 'where', label: 'Location', group: G.storage, kind: 'text', aliases: ['location', 'loc', 'place', 'at'], suggest: true, hint: 'Party, Pal Box, Base 1, Dimensional Storage', get: (row) => text(row, 'location') },
  { key: 'save', label: 'Save (letter or name)', group: G.storage, kind: 'text', aliases: ['world', 'save_id'], suggest: true, hint: 'A, B, … or the save name', get: (row) => [text(row, 'save_id'), text(row, 'save')].filter(Boolean).join(' ') },
  { key: 'owner', label: 'Owner', group: G.storage, kind: 'text', aliases: ['owner_name', 'player'], suggest: true, get: (row) => text(row, 'owner_name') },
  { key: 'file', label: 'Source file', group: G.storage, kind: 'text', aliases: ['source_file', 'source'], suggest: true, get: (row) => text(row, 'source_file') }
];

/** Raw keys already represented by a known field; not offered again as generic fields. */
const CONSUMED_KEYS = new Set([
  'pal_name', 'nickname', 'paldeck_no', 'species_id', 'gender', 'pal_variant', 'is_lucky', 'favorite_index',
  'level', 'rank', 'iv_hp', 'iv_attack', 'iv_defense', 'soul_rank_hp', 'soul_rank_attack', 'soul_rank_defense',
  'soul_rank_craft_speed', 'skills', 'skill_colors', 'combat_moves', 'learned_moves', 'hp', 'full_stomach',
  'sanity', 'physical_health', 'hunger_type', 'worker_sick', 'friendship_points', 'current_work_suitability',
  'exp', 'storage_slot', 'pal_box_slot_index', 'skill_ranks', 'raw_property_names',
  'location', 'save', 'save_id', 'owner_name', 'source_file'
]);

function toTitle(key: string): string {
  return key.split('_').filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

/**
 * Every column in the save is filterable, even ones this registry has never
 * heard of: their kind is inferred from the values actually present.
 */
export function buildFieldRegistry(rows: PalStorageRow[]): FilterField[] {
  const keys = new Set<string>();
  for (const row of rows) Object.keys(row).forEach((key) => keys.add(key));

  const known = new Set(KNOWN_FIELDS.flatMap((field) => [field.key, ...field.aliases]));
  const extras: FilterField[] = [];
  for (const key of Array.from(keys).sort()) {
    if (CONSUMED_KEYS.has(key) || known.has(key)) continue;

    let sawValue = false;
    let allBoolean = true;
    let allNumber = true;
    for (const row of rows) {
      const value = text(row, key).trim();
      if (value === '') continue;
      sawValue = true;
      if (!/^(true|false)$/i.test(value)) allBoolean = false;
      if (!Number.isFinite(Number(value))) allNumber = false;
      if (!allBoolean && !allNumber) break;
    }

    const kind: FieldKind = !sawValue ? 'text' : allBoolean ? 'boolean' : allNumber ? 'number' : 'text';
    extras.push({
      key,
      label: toTitle(key),
      group: G.other,
      kind,
      aliases: [],
      suggest: kind === 'text',
      get: kind === 'boolean'
        ? (row) => truthy(row, key)
        : kind === 'number'
          ? (row) => number(row, key)
          : (row) => text(row, key)
    });
  }

  return [...KNOWN_FIELDS, ...extras];
}

export class FieldLookup {
  private readonly byName = new Map<string, FilterField>();
  readonly byKey = new Map<string, FilterField>();

  constructor(readonly fields: FilterField[]) {
    for (const field of fields) {
      this.byKey.set(field.key, field);
      for (const name of [field.key, ...field.aliases]) {
        this.byName.set(FieldLookup.normalize(name), field);
      }
    }
  }

  static normalize(name: string): string {
    return name.trim().toLowerCase().replace(/[\s-]+/g, '_');
  }

  resolve(name: string): FilterField | undefined {
    return this.byName.get(FieldLookup.normalize(name));
  }

  /** Fields whose key or alias starts with the prefix, best matches first. */
  complete(prefix: string): FilterField[] {
    const needle = FieldLookup.normalize(prefix);
    const scored: Array<{ field: FilterField; score: number }> = [];
    for (const field of this.fields) {
      const names = [field.key, ...field.aliases];
      let score = -1;
      if (!needle) score = 1;
      else if (names.some((name) => name === needle)) score = 4;
      else if (field.key.startsWith(needle)) score = 3;
      else if (names.some((name) => name.startsWith(needle))) score = 2;
      else if (field.label.toLowerCase().includes(needle) || names.some((name) => name.includes(needle))) score = 1;
      if (score > 0) scored.push({ field, score });
    }
    return scored.sort((left, right) => right.score - left.score).map((item) => item.field);
  }
}
