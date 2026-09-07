import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

import { FilterEngine, Suggestion } from './filter-engine';
import { FilterFieldPickerComponent } from './filter-field-picker.component';
import {
  FilterField,
  FilterGroup,
  FilterNode,
  FilterRule,
  SortCriterion,
  OperatorDef,
  cloneNode,
  createGroup,
  createRule,
  defaultOperator,
  operatorDef,
  operatorsFor
} from './filter-model';
import { MOVE_FIELDS, MOVE_SCOPES, type MoveScope } from './move-filters';

interface FieldGroup {
  name: string;
  fields: FilterField[];
}

interface SuggestState {
  ruleId: string;
  items: Suggestion[];
  index: number;
}

/**
 * Visual editor for a filter tree: nested "match all / any" groups holding
 * field / operator / value rules. Mutates the tree in place and emits
 * `changed` so the owner can re-run the filter and re-serialize the query.
 */
@Component({
  selector: 'app-filter-builder',
  standalone: true,
  imports: [CommonModule, FilterFieldPickerComponent],
  templateUrl: './filter-builder.component.html',
  styleUrl: './filter-builder.component.css'
})
export class FilterBuilderComponent {
  @Input({ required: true }) root!: FilterGroup;
  @Input() engine: FilterEngine | null = null;
  @Input() ruleCounts = new Map<string, number>();
  @Input() sorts: SortCriterion[] = [];
  @Input() set fields(fields: FilterField[]) {
    this.fieldMap = new Map([...fields, ...MOVE_FIELDS].map((field) => [field.key, field]));
    const groups = new Map<string, FilterField[]>();
    for (const field of fields) {
      const list = groups.get(field.group) ?? [];
      list.push(field);
      groups.set(field.group, list);
    }
    this.fieldGroups = Array.from(groups, ([name, list]) => ({ name, fields: list }));
  }
  @Output() changed = new EventEmitter<void>();

  fieldGroups: FieldGroup[] = [];
  private fieldMap = new Map<string, FilterField>();

  /** Raw text of the value input while it has focus, so typing is never reformatted. */
  private readonly draftText = new Map<string, string>();
  suggest: SuggestState | null = null;
  private blurTimer: ReturnType<typeof setTimeout> | null = null;
  readonly moveScopes = MOVE_SCOPES;
  private comparisonModes = new Map<string, string>();

  numericFields(rule: FilterRule): FilterField[] {
    return this.availableFields(rule).filter(field => field.kind === 'number');
  }

  availableFields(rule: FilterRule): FilterField[] {
    return MOVE_FIELDS.some(field => field.key === rule.field) ? MOVE_FIELDS : this.fieldGroups.flatMap(group => group.fields);
  }

  comparisonMode(rule: FilterRule): string {
    return this.comparisonModes.get(rule.id) ?? (!rule.values.length || rule.values.every(value => !value.trim() || Number.isFinite(Number(value))) ? 'value'
      : /^[a-z_]\w*(?:\*[\d.]*)?$/i.test(rule.values[0]) ? 'field' : 'formula');
  }

  setComparisonMode(rule: FilterRule, event: Event): void {
    const mode = (event.target as HTMLSelectElement).value;
    this.comparisonModes.set(rule.id, mode);
    rule.values = mode === 'field' ? [this.numericFields(rule).find(field => field.key === 'max_hp')?.key ?? this.numericFields(rule)[0].key] : [];
    this.draftText.delete(rule.id);
    this.emit();
  }

  referenceField(rule: FilterRule): string { const key = rule.values[0]?.split('*')[0] ?? ''; return this.numericFields(rule).find(field => [field.key, ...field.aliases].includes(key))?.key ?? key; }
  referencePercent(rule: FilterRule): string { const factor = rule.values[0]?.split('*')[1]; return factor === undefined ? '100' : factor === '' ? '' : String(Number((Number(factor) * 100).toPrecision(12))); }
  setReference(rule: FilterRule, field: string): void {
    rule.values = [field + (this.referencePercent(rule) === '100' ? '' : `*${Number(this.referencePercent(rule)) / 100}`)];
    this.emit();
  }
  setPercent(rule: FilterRule, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    rule.values = [`${this.referenceField(rule)}${value === '100' ? '' : '*' + (value === '' ? '' : Number(value) / 100)}`];
    this.emit();
  }
  hasComparisonMode(rule: FilterRule): boolean { return this.fieldFor(rule)?.kind === 'number' && !['none', 'two'].includes(this.arity(rule)); }
  errorFor(rule: FilterRule): string | null { return this.engine?.ruleError(rule) ?? null; }

  addMoveGroup(group: FilterGroup): void {
    const child = createGroup('and', [createRule('move_element', 'has_any')]);
    child.scope = 'equipped'; child.match = 'any';
    group.children.push(child);
    this.emit();
  }
  setMoveScope(group: FilterGroup, event: Event): void { group.scope = (event.target as HTMLSelectElement).value as MoveScope; this.emit(); }
  setMoveMatch(group: FilterGroup, event: Event): void { group.match = (event.target as HTMLSelectElement).value as FilterGroup['match']; this.emit(); }

  get sortFields(): FilterField[] { return this.fieldGroups.flatMap(group => group.fields).filter(field => field.key !== 'any'); }
  availableSortFields(index: number): FilterField[] { return this.sortFields.filter(field => !this.sorts.some((sort, i) => i !== index && sort.field === field.key)); }
  addSort(): void {
    const available = this.availableSortFields(-1);
    const field = available.find(field => field.key === 'level') ?? available[0];
    if (field) this.sorts.push({ field: field.key, direction: field.kind === 'number' ? 'desc' : 'asc' });
    this.emit();
  }
  setSortField(index: number, event: Event): void { this.sorts[index].field = (event.target as HTMLSelectElement).value; this.emit(); }
  setSortDirection(index: number, event: Event): void { this.sorts[index].direction = (event.target as HTMLSelectElement).value as 'asc' | 'desc'; this.emit(); }
  moveSort(index: number, direction: number): void { const [sort] = this.sorts.splice(index, 1); this.sorts.splice(index + direction, 0, sort); this.emit(); }
  removeSort(index: number): void { this.sorts.splice(index, 1); this.emit(); }

  fieldFor(rule: FilterRule): FilterField | undefined {
    return this.fieldMap.get(rule.field);
  }

  isUnknownField(rule: FilterRule): boolean {
    return !this.fieldMap.has(rule.field);
  }

  operatorsFor(rule: FilterRule): OperatorDef[] {
    const field = this.fieldFor(rule);
    return field ? operatorsFor(field.kind) : operatorsFor('text');
  }

  arity(rule: FilterRule): OperatorDef['arity'] {
    return operatorDef(rule.op).arity;
  }

  inputType(rule: FilterRule): string {
    const field = this.fieldFor(rule);
    return field?.kind === 'number' && this.comparisonMode(rule) === 'value' && this.arity(rule) !== 'many' ? 'number' : 'text';
  }

  placeholder(rule: FilterRule, slot: 0 | 1 = 0): string {
    const field = this.fieldFor(rule);
    if (!field) return 'value';
    if (field.kind === 'number') {
      if (this.comparisonMode(rule) === 'formula') return 'e.g. max_hp / 2';
      const range = this.engine?.range(field);
      if (this.arity(rule) === 'two') return slot === 0 ? `min${range ? ` (${range.min})` : ''}` : `max${range ? ` (${range.max})` : ''}`;
      if (this.arity(rule) === 'many') return range ? `e.g. ${range.min}, ${range.max}` : 'value, value';
      return range ? `${range.min} – ${range.max}` : 'number';
    }
    if (rule.op === 'regex' || rule.op === 'not_regex') return 'pattern';
    return field.kind === 'list' ? 'skill, skill…' : 'value, value…';
  }

  valueText(rule: FilterRule): string {
    return this.draftText.get(rule.id) ?? rule.values.join(', ');
  }

  singleValue(rule: FilterRule, slot: 0 | 1): string {
    return rule.values[slot] ?? '';
  }

  countFor(rule: FilterRule): number | null {
    return this.ruleCounts.get(rule.id) ?? null;
  }

  hint(rule: FilterRule): string {
    return this.fieldFor(rule)?.hint ?? '';
  }

  trackNode(_: number, node: FilterNode): string {
    return node.id;
  }

  /* ---------------------------------------------------------------- edits */

  addRule(group: FilterGroup): void {
    const previous = [...group.children].reverse().find((child): child is FilterRule => child.type === 'rule');
    const fieldKey = previous ? previous.field : group.scope ? 'move_element' : 'pal';
    const field = this.fieldMap.get(fieldKey);
    group.children.push(createRule(fieldKey, defaultOperator(field?.kind ?? 'list')));
    this.emit();
  }

  addGroup(group: FilterGroup): void {
    const child = createGroup(group.combinator === 'and' ? 'or' : 'and');
    group.children.push(child);
    this.emit();
  }

  remove(parent: FilterGroup, node: FilterNode): void {
    parent.children = parent.children.filter((child) => child !== node);
    this.emit();
  }

  duplicate(parent: FilterGroup, node: FilterNode): void {
    const index = parent.children.indexOf(node);
    parent.children.splice(index + 1, 0, cloneNode(node));
    this.emit();
  }

  setCombinator(group: FilterGroup, combinator: 'and' | 'or'): void {
    if (group.combinator === combinator) return;
    group.combinator = combinator;
    this.emit();
  }

  toggleNegate(group: FilterGroup): void {
    group.negate = !group.negate;
    this.emit();
  }

  clearAll(): void {
    this.root.children = [];
    this.root.combinator = 'and';
    this.root.negate = false;
    this.emit();
  }

  /* -------------------------------------------------------------- field box */

  setField(rule: FilterRule, key: string): void {
    const previous = this.fieldFor(rule);
    const next = this.fieldMap.get(key);
    if (rule.field === key) return;
    rule.field = key;
    if (!next || !previous || next.kind !== previous.kind) {
      rule.op = defaultOperator(next?.kind ?? 'text');
      rule.values = [];
      this.comparisonModes.delete(rule.id);
      this.draftText.delete(rule.id);
    }
    this.emit();
  }

  onOperatorChange(rule: FilterRule, event: Event): void {
    rule.op = (event.target as HTMLSelectElement).value as FilterRule['op'];
    switch (operatorDef(rule.op).arity) {
      case 'none': rule.values = []; break;
      case 'one': rule.values = rule.values.slice(0, 1); break;
      case 'two': rule.values = rule.values.slice(0, 2); break;
      default: break;
    }
    this.draftText.delete(rule.id);
    this.emit();
  }

  onFormulaInput(rule: FilterRule, value: string): void {
    this.comparisonModes.set(rule.id, 'formula');
    rule.values = [value];
    this.emit();
  }

  onValueInput(rule: FilterRule, event: Event): void {
    const text = (event.target as HTMLInputElement).value;
    this.draftText.set(rule.id, text);
    rule.values = this.arity(rule) === 'one' || this.comparisonMode(rule) === 'formula' ? [text] : this.split(text);
    this.refreshSuggestions(rule, text);
    this.emit();
  }

  onSlotInput(rule: FilterRule, slot: 0 | 1, event: Event): void {
    const text = (event.target as HTMLInputElement).value;
    const values = [...rule.values];
    while (values.length < 2) values.push('');
    values[slot] = text;
    rule.values = values;
    this.emit();
  }

  onValueFocus(rule: FilterRule, event: FocusEvent): void {
    if (this.blurTimer) clearTimeout(this.blurTimer);
    const text = (event.target as HTMLInputElement).value;
    this.draftText.set(rule.id, text);
    this.refreshSuggestions(rule, text);
  }

  onValueBlur(rule: FilterRule): void {
    // Delay so a click on a suggestion lands before the list disappears.
    this.blurTimer = setTimeout(() => {
      this.draftText.delete(rule.id);
      if (this.suggest?.ruleId === rule.id) this.suggest = null;
      this.blurTimer = null;
    }, 150);
  }

  onValueKeydown(rule: FilterRule, event: KeyboardEvent): void {
    const state = this.suggest;
    if (!state || state.ruleId !== rule.id || state.items.length === 0) return;
    if (event.key === 'ArrowDown') {
      state.index = (state.index + 1) % state.items.length;
      event.preventDefault();
    } else if (event.key === 'ArrowUp') {
      state.index = (state.index - 1 + state.items.length) % state.items.length;
      event.preventDefault();
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      if (state.index >= 0) {
        this.pickSuggestion(rule, state.items[state.index], event.target as HTMLInputElement);
        event.preventDefault();
      }
    } else if (event.key === 'Escape') {
      this.suggest = null;
      event.stopPropagation();
    }
  }

  pickSuggestion(rule: FilterRule, item: Suggestion, input: HTMLInputElement | null): void {
    if (this.blurTimer) clearTimeout(this.blurTimer);
    const many = this.arity(rule) === 'many';
    const current = this.draftText.get(rule.id) ?? rule.values.join(', ');
    const parts = many ? current.split(',') : [current];
    parts[parts.length - 1] = ` ${item.value}`;
    const text = many ? parts.map((part) => part.trim()).filter(Boolean).join(', ') : item.value;
    this.draftText.set(rule.id, text);
    rule.values = many ? this.split(text) : [text];
    this.suggest = null;
    if (input) {
      input.value = text;
      input.focus();
    }
    this.emit();
  }

  suggestionsFor(rule: FilterRule): Suggestion[] {
    return this.suggest?.ruleId === rule.id ? this.suggest.items : [];
  }

  suggestionIndex(rule: FilterRule): number {
    return this.suggest?.ruleId === rule.id ? this.suggest.index : -1;
  }

  private refreshSuggestions(rule: FilterRule, text: string): void {
    const field = this.fieldFor(rule);
    if (!field || !this.engine || !field.suggest || this.arity(rule) === 'none' || rule.op === 'regex' || rule.op === 'not_regex') {
      this.suggest = null;
      return;
    }
    const segment = this.arity(rule) === 'many' ? text.split(',').pop() ?? '' : text;
    const items = this.engine.suggestions(field, segment.trim(), 10);
    this.suggest = items.length ? { ruleId: rule.id, items, index: -1 } : null;
  }

  private split(text: string): string[] {
    return text.split(',').map((part) => part.trim()).filter((part) => part !== '');
  }

  private emit(): void {
    this.changed.emit();
  }
}
