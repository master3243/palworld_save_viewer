import type { PalStorageRow } from '../save-parser.service';
import {
  FieldLookup,
  FilterField,
  FilterGroup,
  FilterNode,
  FilterRule,
  isRuleActive,
  splitList
} from './filter-model';

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

  constructor(readonly lookup: FieldLookup, private readonly rows: PalStorageRow[]) {}

  filter(root: FilterGroup): PalStorageRow[] {
    return this.rows.filter((row) => this.matchesNode(row, root));
  }

  count(node: FilterNode): number {
    let total = 0;
    for (const row of this.rows) if (this.matchesNode(row, node)) total += 1;
    return total;
  }

  matchesNode(row: PalStorageRow, node: FilterNode): boolean {
    if (node.type === 'rule') return this.matchesRule(row, node);
    const result = node.combinator === 'and'
      ? node.children.every((child) => this.matchesNode(row, child))
      : node.children.length === 0 || node.children.some((child) => this.matchesNode(row, child));
    return node.negate ? !result : result;
  }

  matchesRule(row: PalStorageRow, rule: FilterRule): boolean {
    const field = this.lookup.byKey.get(rule.field);
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
      const numbers = values.map((item) => Number(item));
      const first = numbers[0];
      switch (rule.op) {
        case 'eq': return numbers.some((expected) => expected === actual);
        case 'neq': return !numbers.some((expected) => expected === actual);
        case 'gt': return Number.isFinite(first) ? actual > first : true;
        case 'gte': return Number.isFinite(first) ? actual >= first : true;
        case 'lt': return Number.isFinite(first) ? actual < first : true;
        case 'lte': return Number.isFinite(first) ? actual <= first : true;
        case 'between': return this.between(actual, rule.values);
        case 'not_between': return !this.between(actual, rule.values);
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
        const value = this.valueOf(row, field);
        const items = value.kind === 'list' ? value.items : value.kind === 'text' ? [value.value] : [];
        for (const item of items) {
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

  private between(actual: number, values: string[]): boolean {
    const low = Number(values[0]);
    const high = Number(values[1]);
    const lowOk = values[0]?.trim() === '' || !Number.isFinite(low) || actual >= low;
    const highOk = values[1] === undefined || values[1].trim() === '' || !Number.isFinite(high) || actual <= high;
    return lowOk && highOk;
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
