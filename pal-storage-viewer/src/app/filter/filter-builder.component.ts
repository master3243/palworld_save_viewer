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

/** The field picker of one rule while it is open: the groups still matching the typed text. */
interface FieldMenuState {
  ruleId: string;
  sections: FieldGroup[];
  active: FilterField | null;
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
  fieldMenu: FieldMenuState | null = null;
  /** What the user has typed in a field box, kept until they pick or leave. */
  private readonly fieldDraft = new Map<string, string>();
  private fieldBlurTimer: ReturnType<typeof setTimeout> | null = null;

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

  fieldText(rule: FilterRule): string {
    return this.fieldDraft.get(rule.id) ?? (this.fieldFor(rule)?.label ?? rule.field);
  }

  onFieldFocus(rule: FilterRule, event: FocusEvent): void {
    if (this.fieldBlurTimer) clearTimeout(this.fieldBlurTimer);
    const input = event.target as HTMLInputElement;
    // Start from an empty box so the first keystroke searches, but keep the current label visible as placeholder.
    this.fieldDraft.set(rule.id, '');
    input.value = '';
    input.placeholder = this.fieldFor(rule)?.label ?? rule.field;
    this.openFieldMenu(rule, '');
    this.revealActive(input);
  }

  onFieldInput(rule: FilterRule, event: Event): void {
    const text = (event.target as HTMLInputElement).value;
    this.fieldDraft.set(rule.id, text);
    this.openFieldMenu(rule, text);
  }

  onFieldBlur(rule: FilterRule): void {
    this.fieldBlurTimer = setTimeout(() => {
      this.fieldDraft.delete(rule.id);
      if (this.fieldMenu?.ruleId === rule.id) this.fieldMenu = null;
      this.fieldBlurTimer = null;
    }, 150);
  }

  onFieldKeydown(rule: FilterRule, event: KeyboardEvent, input: HTMLInputElement): void {
    const menu = this.fieldMenu?.ruleId === rule.id ? this.fieldMenu : null;
    if (!menu) {
      if (event.key === 'ArrowDown') { this.openFieldMenu(rule, this.fieldDraft.get(rule.id) ?? ''); event.preventDefault(); }
      return;
    }
    const flat = menu.sections.flatMap((section) => section.fields);
    const position = menu.active ? flat.indexOf(menu.active) : -1;
    if (event.key === 'ArrowDown') {
      menu.active = flat[(position + 1) % flat.length] ?? null;
      this.revealActive(input);
      event.preventDefault();
    } else if (event.key === 'ArrowUp') {
      menu.active = flat[(position - 1 + flat.length) % flat.length] ?? null;
      this.revealActive(input);
      event.preventDefault();
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      const choice = menu.active ?? (flat.length === 1 ? flat[0] : null);
      if (choice) {
        this.pickField(rule, choice, input);
        event.preventDefault();
      }
    } else if (event.key === 'Escape') {
      this.fieldMenu = null;
      input.blur();
      event.stopPropagation();
    }
  }

  toggleFieldMenu(rule: FilterRule, input: HTMLInputElement): void {
    if (this.fieldMenu?.ruleId === rule.id && (this.fieldDraft.get(rule.id) ?? '') === '') {
      this.fieldMenu = null;
      input.blur();
      return;
    }
    if (document.activeElement !== input) input.focus();
    this.fieldDraft.set(rule.id, '');
    input.value = '';
    this.openFieldMenu(rule, '');
    this.revealActive(input);
  }

  /** Scroll the list so the highlighted (or current) field is visible; runs after the list renders. */
  private revealActive(input: HTMLInputElement): void {
    setTimeout(() => input.parentElement?.querySelector('li.active, li.selected')?.scrollIntoView({ block: 'nearest' }));
  }

  pickField(rule: FilterRule, field: FilterField, input: HTMLInputElement | null): void {
    if (this.fieldBlurTimer) clearTimeout(this.fieldBlurTimer);
    this.fieldMenu = null;
    this.fieldDraft.delete(rule.id);
    if (input) {
      input.value = field.label;
      input.blur();
    }
    this.applyField(rule, field.key);
  }

  /** Groups whose fields match the typed text on label, key, alias or hint (all when empty). */
  private openFieldMenu(rule: FilterRule, text: string): void {
    const query = text.trim().toLowerCase();
    const matches = (field: FilterField) => !query
      || field.label.toLowerCase().includes(query)
      || field.key.toLowerCase().includes(query)
      || field.aliases.some((alias) => alias.toLowerCase().includes(query))
      || (field.hint ?? '').toLowerCase().includes(query);
    const sections = this.fieldGroups.map((group) => ({ name: group.name, fields: group.fields.filter(matches) })).filter((group) => group.fields.length);
    const flat = sections.flatMap((section) => section.fields);
    // Prefer a label that starts with the text, then the current field, so Enter does the obvious thing.
    const active = query ? flat.find((field) => field.label.toLowerCase().startsWith(query)) ?? flat[0] ?? null : null;
    this.fieldMenu = { ruleId: rule.id, sections, active };
  }

  private applyField(rule: FilterRule, key: string): void {
    const previous = this.fieldFor(rule);
    const next = this.fieldMap.get(key);
    if (rule.field === key) return;
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
