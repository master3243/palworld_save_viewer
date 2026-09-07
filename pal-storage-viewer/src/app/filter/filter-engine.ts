import type { PalStorageRow } from '../save-parser.service';
import {
  FieldLookup,
  FilterField,
  FilterGroup,
  FilterNode,
  FilterRule,
  SortCriterion,
  operatorDef,
  isRuleActive,
  isEmptyTree,
  splitList
} from './filter-model';
import { MoveCatalog, MOVE_FIELDS, MOVE_SCOPES } from './move-filters';
import { numericExpression, type NumericExpression } from './numeric-expression';

type Normalized =
  | { kind: 'text'; value: string; lower: string }
  | { kind: 'number'; value: number | null }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'list'; items: string[]; lower: string[] };

export interface Suggestion {
  value: string;
  count: number;
}

/**
 * Evaluates a filter tree against rows. Field values are normalized once per
 * row and cached, so re-filtering on every keystroke stays cheap even for
 * multi-thousand row saves.
 */
export class FilterEngine {
  private readonly cache = new WeakMap<PalStorageRow, Map<string, Normalized>>();
  private readonly regexCache = new Map<string, RegExp | null>();
  private readonly suggestionCache = new Map<string, Suggestion[]>();
  private readonly rangeCache = new Map<string, { min: number; max: number } | null>();
  private readonly expressions = new Map<string, NumericExpression>();
  readonly moveLookup = new FieldLookup(MOVE_FIELDS);

  constructor(readonly lookup: FieldLookup, private readonly rows: PalStorageRow[], readonly moves = new MoveCatalog()) {}

  filter(root: FilterGroup): PalStorageRow[] {
    return this.rows.filter((row) => this.matchesNode(row, root));
  }

  count(node: FilterNode): number {
    let total = 0;
    for (const row of this.rows) if (this.matchesNode(row, node)) total += 1;
    return total;
  }

  matchesNode(row: PalStorageRow, node: FilterNode): boolean {
    return this.evaluateNode(row, node) ?? true;
  }

  /** Incomplete rules are absent from AND, OR and NOT alike. */
  private evaluateNode(row: PalStorageRow, node: FilterNode): boolean | null {
    if (node.type === 'rule' && (!isRuleActive(node) || this.ruleError(node))) return null;
    if (node.type === 'rule') return this.matchesRule(row, node);
    if (isEmptyTree(node)) return null;
    if (node.scope) {
      const group = { ...node, scope: undefined, negate: false };
      if (!node.children.length) return null;
      const results = this.moves.rows(row, node.scope).map(move => this.evaluateNode(move, group));
      if (results.length && results.every(value => value === null)) return null;
      const result = node.match === 'none' ? !results.some(value => value === true)
        : node.match === 'all' ? results.length > 0 && results.every(value => value === true)
        : results.some(value => value === true);
      return node.negate ? !result : result;
    }
    const children = node.children.map(child => this.evaluateNode(row, child)).filter((value): value is boolean => value !== null);
    if (!children.length) return null;
    const result = node.combinator === 'and'
      ? children.every(Boolean)
      : children.some(Boolean);
    return node.negate ? !result : result;
  }

  matchesRule(row: PalStorageRow, rule: FilterRule): boolean {
    const field = this.field(rule.field);
    // Unknown fields and half-typed rules never hide anything.
    if (!field || !isRuleActive(rule)) return true;

    const value = this.valueOf(row, field);
    const values = rule.values.map((item) => item.trim()).filter((item) => item !== '');
    const lowers = values.map((item) => item.toLowerCase());

    switch (rule.op) {
      case 'empty': return this.isEmpty(value);
      case 'not_empty': return !this.isEmpty(value);
      case 'is_true': return value.kind === 'boolean' ? value.value : !this.isEmpty(value);
      case 'is_false': return value.kind === 'boolean' ? !value.value : this.isEmpty(value);
      default: break;
    }

    if (value.kind === 'text') {
      const text = value.lower;
      switch (rule.op) {
        case 'contains': return lowers.some((needle) => text.includes(needle));
        case 'not_contains': return !lowers.some((needle) => text.includes(needle));
        case 'is': return lowers.some((needle) => text === needle);
        case 'is_not': return !lowers.some((needle) => text === needle);
        case 'starts': return lowers.some((needle) => text.startsWith(needle));
        case 'not_starts': return !lowers.some((needle) => text.startsWith(needle));
        case 'regex': return this.regexTest(values[0], value.value);
        case 'not_regex': return !this.regexTest(values[0], value.value);
        default: return true;
      }
    }

    if (value.kind === 'number') {
      const actual = value.value;
      if (actual === null) return false;
      const numbers = values.map((item) => this.expression(item, rule).evaluate(row));
      if (numbers.some(number => number === null)) return false;
      const first = numbers[0];
      switch (rule.op) {
        case 'eq': return numbers.some((expected) => expected === actual);
        case 'neq': return !numbers.some((expected) => expected === actual);
        case 'gt': return first !== null && actual > first;
        case 'gte': return first !== null && actual >= first;
        case 'lt': return first !== null && actual < first;
        case 'lte': return first !== null && actual <= first;
        case 'between': case 'not_between': {
          const low = rule.values[0]?.trim() ? this.expression(rule.values[0], rule).evaluate(row) : -Infinity;
          const high = rule.values[1]?.trim() ? this.expression(rule.values[1], rule).evaluate(row) : Infinity;
          if (low === null || high === null) return false;
          const inside = actual >= low && actual <= high;
          return rule.op === 'between' ? inside : !inside;
        }
        default: return true;
      }
    }

    if (value.kind === 'list') {
      const items = value.lower;
      const hasMatch = (needle: string) => items.some((item) => item.includes(needle));
      switch (rule.op) {
        case 'has_any': return lowers.some(hasMatch);
        case 'has_all': return lowers.every(hasMatch);
        case 'has_none': return !lowers.some(hasMatch);
        case 'not_has_all': return !lowers.every(hasMatch);
        default: return true;
      }
    }

    return true;
  }

  /** Distinct values for a field, most common first, optionally narrowed by a query. */
  suggestions(field: FilterField, query = '', limit = 12): Suggestion[] {
    if (field.kind !== 'text' && field.kind !== 'list') return [];
    let all = this.suggestionCache.get(field.key);
    if (!all) {
      const counts = new Map<string, number>();
      for (const row of this.rows) {
        const records = this.moveLookup.byKey.has(field.key)
          ? MOVE_SCOPES.flatMap(scope => this.moves.rows(row, scope.key)) : [row];
        const items = records.flatMap(record => {
          const value = this.valueOf(record, field);
          return value.kind === 'list' ? value.items : value.kind === 'text' ? [value.value] : [];
        });
        for (const item of new Set(items)) {
          if (!item) continue;
          counts.set(item, (counts.get(item) ?? 0) + 1);
        }
      }
      all = Array.from(counts, ([value, count]) => ({ value, count }))
        .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value));
      this.suggestionCache.set(field.key, all);
    }

    const needle = query.trim().toLowerCase();
    if (!needle) return all.slice(0, limit);
    const starts = all.filter((item) => item.value.toLowerCase().startsWith(needle));
    const inside = all.filter((item) => !item.value.toLowerCase().startsWith(needle) && item.value.toLowerCase().includes(needle));
    return [...starts, ...inside].slice(0, limit);
  }

  range(field: FilterField): { min: number; max: number } | null {
    if (field.kind !== 'number') return null;
    if (!this.rangeCache.has(field.key)) {
      let min = Infinity;
      let max = -Infinity;
      for (const row of this.rows) {
        const value = this.valueOf(row, field);
        if (value.kind !== 'number' || value.value === null) continue;
        min = Math.min(min, value.value);
        max = Math.max(max, value.value);
      }
      this.rangeCache.set(field.key, Number.isFinite(min) ? { min, max } : null);
    }
    return this.rangeCache.get(field.key) ?? null;
  }

  field(key: string): FilterField | undefined {
    return this.moveLookup.byKey.get(key) ?? this.lookup.byKey.get(key);
  }

  private expression(source: string, rule: FilterRule): NumericExpression {
    const move = this.moveLookup.byKey.has(rule.field);
    const key = `${move}:${source}`;
    let expression = this.expressions.get(key);
    if (!expression) {
      expression = numericExpression(source, move ? this.moveLookup : this.lookup);
      this.expressions.set(key, expression);
    }
    return expression;
  }

  ruleError(rule: FilterRule): string | null {
    const field = this.field(rule.field);
    if (!field) return `Unknown field "${rule.field}"`;
    if (!operatorDef(rule.op).kinds.includes(field.kind)) return `Invalid operator for ${field.label}`;
    if (!isRuleActive(rule)) return null;
    if (field.kind === 'number') {
      for (const value of rule.values.filter(value => value.trim())) {
        const error = this.expression(value, rule).error;
        if (error) return error;
      }
    }
    if (rule.op === 'regex' || rule.op === 'not_regex') {
      try { new RegExp(rule.values[0], 'i'); } catch { return 'Invalid regular expression'; }
    }
    return null;
  }

  errors(node: FilterNode): string[] {
    return node.type === 'rule' ? [this.ruleError(node)].filter((error): error is string => !!error)
      : node.children.flatMap(child => this.errors(child));
  }

  sort(rows: PalStorageRow[], criteria: SortCriterion[]): PalStorageRow[] {
    if (!criteria.length) return rows;
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    const locationRank = (value: string): number => value === 'Party' ? 0 : /^Base \d+/.test(value) ? 1 + Number(value.match(/\d+/)![0]) : value === 'Pal Box' ? 1000 : value === 'DimsPS' ? 2000 : value && value !== 'Unknown' ? 3000 : 4000;
    const value = (row: PalStorageRow, field: FilterField): unknown => field.key === 'no' ? row['paldeck_no'] : field.get(row);
    return [...rows].sort((a, b) => {
      for (const criterion of criteria) {
        const field = this.lookup.byKey.get(criterion.field);
        if (!field) continue;
        const av = value(a, field), bv = value(b, field);
        const empty = (value: unknown) => value === null || value === undefined || value === '' || (typeof value === 'number' && !Number.isFinite(value)) || (Array.isArray(value) && !value.length);
        if (empty(av) || empty(bv)) { const order = Number(empty(av)) - Number(empty(bv)); if (order) return order; continue; }
        const order = field.key === 'where' ? locationRank(String(av)) - locationRank(String(bv))
          : typeof av === 'number' && typeof bv === 'number' ? av - bv
          : collator.compare(String(av), String(bv));
        if (order) return order * (criterion.direction === 'asc' ? 1 : -1);
      }
      return 0;
    });
  }

  private valueOf(row: PalStorageRow, field: FilterField): Normalized {
    let perRow = this.cache.get(row);
    if (!perRow) {
      perRow = new Map();
      this.cache.set(row, perRow);
    }
    let normalized = perRow.get(field.key);
    if (!normalized) {
      normalized = this.normalize(field, field.get(row));
      perRow.set(field.key, normalized);
    }
    return normalized;
  }

  private normalize(field: FilterField, raw: unknown): Normalized {
    switch (field.kind) {
      case 'number': {
        const value = typeof raw === 'number' ? raw : raw === null || raw === undefined || raw === '' ? NaN : Number(raw);
        return { kind: 'number', value: Number.isFinite(value) ? value : null };
      }
      case 'boolean':
        return { kind: 'boolean', value: Boolean(raw) };
      case 'list': {
        const items = Array.isArray(raw) ? raw.map(String) : splitList(raw === null || raw === undefined ? '' : String(raw));
        return { kind: 'list', items, lower: items.map((item) => item.toLowerCase()) };
      }
      default: {
        const value = raw === null || raw === undefined ? '' : String(raw).trim();
        return { kind: 'text', value, lower: value.toLowerCase() };
      }
    }
  }

  private isEmpty(value: Normalized): boolean {
    switch (value.kind) {
      case 'text': return value.value === '';
      case 'number': return value.value === null;
      case 'list': return value.items.length === 0;
      default: return !value.value;
    }
  }

  private regexTest(pattern: string | undefined, text: string): boolean {
    if (!pattern) return true;
    if (!this.regexCache.has(pattern)) {
      try {
        this.regexCache.set(pattern, new RegExp(pattern, 'i'));
      } catch {
        this.regexCache.set(pattern, null);
      }
    }
    const regex = this.regexCache.get(pattern);
    // An invalid pattern is most likely mid-edit; do not blank the table.
    return regex ? regex.test(text) : true;
  }
}
