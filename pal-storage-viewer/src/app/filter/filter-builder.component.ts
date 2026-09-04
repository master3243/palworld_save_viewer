import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

import { FilterEngine, Suggestion } from './filter-engine';
import {
  FilterField,
  FilterGroup,
  FilterNode,
  FilterRule,
  OperatorDef,
  cloneNode,
  createGroup,
  createRule,
  defaultOperator,
  operatorDef,
  operatorsFor
} from './filter-model';

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
  imports: [CommonModule],
  templateUrl: './filter-builder.component.html',
  styleUrl: './filter-builder.component.css'
})
export class FilterBuilderComponent {
  @Input({ required: true }) root!: FilterGroup;
  @Input() engine: FilterEngine | null = null;
  @Input() ruleCounts = new Map<string, number>();
  @Input() set fields(fields: FilterField[]) {
    this.fieldMap = new Map(fields.map((field) => [field.key, field]));
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
    return field?.kind === 'number' && this.arity(rule) !== 'many' ? 'number' : 'text';
  }

  placeholder(rule: FilterRule, slot: 0 | 1 = 0): string {
    const field = this.fieldFor(rule);
    if (!field) return 'value';
    if (field.kind === 'number') {
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
    const fieldKey = previous ? previous.field : 'skills';
    const field = this.fieldMap.get(fieldKey);
    group.children.push(createRule(fieldKey, defaultOperator(field?.kind ?? 'list')));
    this.emit();
  }

  addGroup(group: FilterGroup): void {
    const child = createGroup(group.combinator === 'and' ? 'or' : 'and');
    child.children.push(createRule('skills', 'has_any'));
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

  onFieldChange(rule: FilterRule, event: Event): void {
    const key = (event.target as HTMLSelectElement).value;
    const previous = this.fieldFor(rule);
    const next = this.fieldMap.get(key);
    rule.field = key;
    if (!next || !previous || next.kind !== previous.kind) {
      rule.op = defaultOperator(next?.kind ?? 'text');
      rule.values = [];
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

  onValueInput(rule: FilterRule, event: Event): void {
    const text = (event.target as HTMLInputElement).value;
    this.draftText.set(rule.id, text);
    rule.values = this.arity(rule) === 'one' ? [text] : this.split(text);
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
