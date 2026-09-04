import { CommonModule } from '@angular/common';
import {
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  ViewChild
} from '@angular/core';

import type { PalStorageRow } from '../save-parser.service';
import { GenderIconComponent } from '../gender-icon.component';
import { FilterBuilderComponent } from './filter-builder.component';
import { FilterEngine } from './filter-engine';
import {
  FieldLookup,
  FilterField,
  FilterGroup,
  FilterNode,
  FilterRule,
  buildFieldRegistry,
  countActiveRules,
  createGroup,
  createRule,
  isEmptyTree,
  operatorDef,
  rulesEqual
} from './filter-model';
import { completionContext, parseQuery, quoteValue, serializeQuery } from './filter-query';

interface ChipState {
  /** Label shown while this state is active. */
  label: string;
  title: string;
  tone: 'include' | 'exclude' | 'female' | 'male';
  make: () => FilterRule;
}

/**
 * A quick chip cycles through its states on each click and back to off:
 * off -> include (+) -> exclude (-) -> off, or off -> female -> male -> off.
 */
interface QuickChip {
  /** Label shown while the chip is off. */
  label: string;
  title: string;
  states: ChipState[];
}

interface SearchSuggestion {
  insert: string;
  label: string;
  detail: string;
  kind: 'field' | 'value';
}

interface Preset {
  name: string;
  query: string;
}

interface HelpExample {
  query: string;
  meaning: string;
}

const PRESET_STORAGE_KEY = 'pal-storage-viewer.filter-presets';

function flagChip(label: string, title: string, field: string): QuickChip {
  return {
    label,
    title,
    states: [
      { label, title, tone: 'include', make: () => createRule(field, 'is_true') },
      { label, title: `Not ${title.toLowerCase()}`, tone: 'exclude', make: () => createRule(field, 'is_false') }
    ]
  };
}

function numberChip(label: string, title: string, field: string, op: FilterRule['op'], values: string[]): QuickChip {
  return {
    label,
    title,
    states: [
      { label, title, tone: 'include', make: () => createRule(field, op, values) },
      { label, title: `Not: ${title.toLowerCase()}`, tone: 'exclude', make: () => createRule(field, operatorDef(op).negated, values) }
    ]
  };
}

/**
 * Owns the filter state for the table. Three ways in, one model:
 *  - quick chips toggle common rules,
 *  - the search box accepts free text or the query syntax,
 *  - the builder panel edits the same tree visually.
 * Any change re-serializes the query text and re-filters the rows.
 */
@Component({
  selector: 'app-filter-bar',
  standalone: true,
  imports: [CommonModule, FilterBuilderComponent, GenderIconComponent],
  templateUrl: './filter-bar.component.html',
  styleUrl: './filter-bar.component.css'
})
export class FilterBarComponent implements OnChanges {
  @Input() rows: PalStorageRow[] = [];
  @Output() filtered = new EventEmitter<PalStorageRow[]>();

  @ViewChild('searchInput') searchInput?: ElementRef<HTMLInputElement>;

  root: FilterGroup = createGroup();
  fields: FilterField[] = [];
  lookup = new FieldLookup([]);
  engine: FilterEngine | null = null;
  ruleCounts = new Map<string, number>();

  queryText = '';
  unknownFields: string[] = [];
  matchCount = 0;
  isPanelOpen = false;
  isHelpOpen = false;
  isSavingPreset = false;
  presetName = '';
  presets: Preset[] = [];

  suggestions: SearchSuggestion[] = [];
  suggestionIndex = -1;
  private suggestionsVisible = false;

  readonly quickChips: QuickChip[] = [
    flagChip('Alpha', 'Alpha pals', 'alpha'),
    flagChip('★ Lucky', 'Lucky pals', 'lucky'),
    {
      label: '♂♀',
      title: 'Gender: click to cycle male, female, any',
      states: [
        { label: '♂', title: 'Male only', tone: 'male', make: () => createRule('gender', 'is', ['Male']) },
        { label: '♀', title: 'Female only', tone: 'female', make: () => createRule('gender', 'is', ['Female']) }
      ]
    },
    flagChip('Fav', 'Marked as favorite', 'favorite'),
    numberChip('4★', 'Max rank (4 stars)', 'rank', 'eq', ['4']),
    numberChip('=300 IV', 'Perfect IVs (100 / 100 / 100)', 'iv', 'eq', ['300']),
    numberChip('≥60 SR', 'Perfect soul ranks (HP + Attack + Defense at 60 or more)', 'sr', 'gte', ['60']),
    numberChip('4 platinum', 'Four platinum tier passives', 'platinum', 'eq', ['4']),
    numberChip('0 negatives', 'No negative passives', 'negative', 'eq', ['0']),
    {
      label: 'Nicknamed',
      title: 'Has a nickname',
      states: [
        { label: 'Nicknamed', title: 'Has a nickname', tone: 'include', make: () => createRule('nick', 'not_empty') },
        { label: 'Nicknamed', title: 'Has no nickname', tone: 'exclude', make: () => createRule('nick', 'empty') }
      ]
    }
  ];

  readonly helpExamples: HelpExample[] = [
    { query: 'anubis', meaning: 'name, nickname, passive or move contains "anubis"' },
    { query: 'level>=40 atk>=90', meaning: 'both conditions (space means AND)' },
    { query: 'hp>=90 OR def>=90', meaning: 'either condition' },
    { query: 'skills:Legend,Musclehead', meaning: 'has any of these passives' },
    { query: 'skills:Legend&Musclehead', meaning: 'has all of these passives' },
    { query: '-skills:Brittle', meaning: 'does not have this passive' },
    { query: 'is:alpha -is:lucky', meaning: 'yes/no flags: alpha, lucky, favorite, male, female' },
    { query: 'gender=male', meaning: '= is exact, : is contains' },
    { query: 'iv:250..300', meaning: 'between two numbers' },
    { query: 'iv_min>=80 platinum>=1', meaning: 'derived stats: IV lowest, passive tier counts' },
    { query: 'nick:*', meaning: 'has a nickname (field is set)' },
    { query: 'pal~"^Jet"', meaning: 'regular expression' },
    { query: '(hp>=90 OR def>=90) -(is:alpha OR level<20)', meaning: 'parentheses and NOT groups' }
  ];

  constructor(private readonly host: ElementRef<HTMLElement>) {
    this.presets = this.loadPresets();
  }

  get total(): number {
    return this.rows.length;
  }

  get isActive(): boolean {
    return !isEmptyTree(this.root);
  }

  get activeRuleCount(): number {
    return countActiveRules(this.root);
  }

  fieldGroups: Array<{ name: string; fields: FilterField[] }> = [];

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['rows']) return;
    this.fields = buildFieldRegistry(this.rows);
    this.lookup = new FieldLookup(this.fields);
    const groups = new Map<string, FilterField[]>();
    for (const field of this.fields) {
      const list = groups.get(field.group) ?? [];
      list.push(field);
      groups.set(field.group, list);
    }
    this.fieldGroups = Array.from(groups, ([name, fields]) => ({ name, fields }));
    this.engine = this.rows.length ? new FilterEngine(this.lookup, this.rows) : null;
    this.suggestions = [];

    // A new save (or a return to the drop screen) always starts unfiltered.
    this.queryText = '';
    this.root = createGroup();
    this.unknownFields = [];
    // The parent is mid change-detection when inputs arrive; emit afterwards.
    void Promise.resolve().then(() => this.recompute());
  }

  /* ------------------------------------------------------------- search box */

  onQueryInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.queryText = input.value;
    const result = parseQuery(this.queryText, this.lookup);
    this.root = result.root;
    this.unknownFields = result.unknownFields;
    this.recompute();
    this.suggestionsVisible = true;
    this.updateSuggestions(input);
  }

  onQueryFocus(event: FocusEvent): void {
    this.suggestionsVisible = true;
    this.updateSuggestions(event.target as HTMLInputElement);
  }

  onQueryClick(event: MouseEvent): void {
    this.updateSuggestions(event.target as HTMLInputElement);
  }

  onQueryKeydown(event: KeyboardEvent): void {
    const input = event.target as HTMLInputElement;
    if (event.key === 'Escape') {
      if (this.suggestions.length) {
        this.suggestions = [];
        event.stopPropagation();
      } else if (this.queryText) {
        this.clear();
        event.stopPropagation();
      }
      return;
    }
    if (!this.suggestions.length) return;
    if (event.key === 'ArrowDown') {
      this.suggestionIndex = (this.suggestionIndex + 1) % this.suggestions.length;
      event.preventDefault();
    } else if (event.key === 'ArrowUp') {
      this.suggestionIndex = (this.suggestionIndex - 1 + this.suggestions.length) % this.suggestions.length;
      event.preventDefault();
    } else if ((event.key === 'Enter' || event.key === 'Tab') && this.suggestionIndex >= 0) {
      this.acceptSuggestion(this.suggestions[this.suggestionIndex], input);
      event.preventDefault();
    } else if (event.key === 'Enter') {
      this.suggestions = [];
    }
  }

  onQueryBlur(): void {
    setTimeout(() => {
      this.suggestionsVisible = false;
      this.suggestions = [];
    }, 150);
  }

  acceptSuggestion(item: SearchSuggestion, input: HTMLInputElement | null): void {
    const target = input ?? this.searchInput?.nativeElement;
    if (!target) return;
    const context = completionContext(this.queryText, target.selectionStart ?? this.queryText.length);
    if (!context) return;

    const start = context.mode === 'field' ? context.termStart : context.segmentStart;
    let end = context.caret;
    // Swallow a closing quote we may be sitting in front of.
    if (context.inQuotes && this.queryText[end] === '"') end += 1;
    const trailing = item.kind === 'value' && !/^[\s)]/.test(this.queryText.slice(end)) ? ' ' : '';
    const next = this.queryText.slice(0, start) + item.insert + trailing + this.queryText.slice(end);
    const caret = start + item.insert.length + trailing.length;

    this.queryText = next;
    target.value = next;
    target.setSelectionRange(caret, caret);
    target.focus();
    const result = parseQuery(next, this.lookup);
    this.root = result.root;
    this.unknownFields = result.unknownFields;
    this.recompute();
    this.suggestionsVisible = true;
    this.updateSuggestions(target);
  }

  private updateSuggestions(input: HTMLInputElement): void {
    this.suggestionIndex = -1;
    if (!this.suggestionsVisible || !this.engine) {
      this.suggestions = [];
      return;
    }
    const context = completionContext(this.queryText, input.selectionStart ?? this.queryText.length);
    // Only complete at the end of a term; a caret parked mid-word is not a request for help.
    const after = context ? this.queryText[context.caret] : undefined;
    if (!context || (after !== undefined && !/[\s)]/.test(after))) {
      this.suggestions = [];
      return;
    }

    if (context.mode === 'field') {
      if (!context.prefix) {
        this.suggestions = [];
        return;
      }
      const isPrefix = 'is'.startsWith(context.prefix.toLowerCase());
      const fields = this.lookup.complete(context.prefix).slice(0, 8).map((field) => ({
        kind: 'field' as const,
        insert: field.kind === 'boolean' ? `is:${field.key}` : field.kind === 'number' ? `${field.key}>=` : `${field.key}:`,
        label: field.key,
        detail: field.label + (field.kind === 'number' ? ' (number)' : field.kind === 'boolean' ? ' (yes/no)' : '')
      }));
      this.suggestions = isPrefix
        ? [{ kind: 'field', insert: 'is:', label: 'is:', detail: 'alpha, lucky, favorite, male, female…' }, ...fields]
        : fields;
      return;
    }

    const fieldName = context.field?.toLowerCase() ?? '';
    if (fieldName === 'is' || fieldName === 'has') {
      const options = [
        ...this.fields.filter((field) => field.kind === 'boolean').map((field) => ({ key: field.key, label: field.label })),
        { key: 'male', label: 'Gender is male' },
        { key: 'female', label: 'Gender is female' }
      ];
      const needle = context.prefix.toLowerCase();
      this.suggestions = options
        .filter((option) => option.key.includes(needle) || option.label.toLowerCase().includes(needle))
        .slice(0, 8)
        .map((option) => ({ kind: 'value' as const, insert: option.key, label: option.key, detail: option.label }));
      return;
    }

    const field = this.lookup.resolve(fieldName);
    if (!field || !field.suggest) {
      this.suggestions = [];
      return;
    }
    this.suggestions = this.engine.suggestions(field, context.prefix, 8).map((item) => ({
      kind: 'value' as const,
      insert: quoteValue(item.value),
      label: item.value,
      detail: `${item.count}`
    }));
  }

  /* ------------------------------------------------------------- quick chips */

  /** Index of the chip state currently present in the root group, or -1 when off. */
  chipStateIndex(chip: QuickChip): number {
    return chip.states.findIndex((state) => {
      const rule = state.make();
      return this.root.children.some((child) => child.type === 'rule' && rulesEqual(child, rule));
    });
  }

  chipState(chip: QuickChip): ChipState | null {
    const index = this.chipStateIndex(chip);
    return index >= 0 ? chip.states[index] : null;
  }

  isGenderChip(chip: QuickChip): boolean {
    return chip.states[0]?.tone === 'male';
  }

  chipLabel(chip: QuickChip): string {
    return this.chipState(chip)?.label ?? chip.label;
  }

  chipTitle(chip: QuickChip): string {
    const state = this.chipState(chip);
    return state ? `${state.title} (click to change)` : chip.title;
  }

  cycleChip(chip: QuickChip): void {
    const current = this.chipStateIndex(chip);
    const rules = chip.states.map((state) => state.make());
    this.root.children = this.root.children.filter(
      (child) => child.type !== 'rule' || !rules.some((rule) => rulesEqual(child, rule))
    );

    const nextIndex = current + 1;
    if (nextIndex < chip.states.length) {
      if (this.root.combinator === 'or' && this.root.children.length > 1) {
        // Keep the user's OR block intact and AND the chip with it.
        this.root = createGroup('and', [this.root]);
      }
      this.root.children.push(rules[nextIndex]);
    }
    this.onTreeChanged();
  }

  /* ---------------------------------------------------------------- builder */

  onTreeChanged(): void {
    this.queryText = serializeQuery(this.root, this.lookup);
    this.unknownFields = [];
    this.recompute();
  }

  togglePanel(): void {
    this.isPanelOpen = !this.isPanelOpen;
    if (this.isPanelOpen) this.isHelpOpen = false;
  }

  toggleHelp(): void {
    this.isHelpOpen = !this.isHelpOpen;
  }

  closeHelp(): void {
    this.isHelpOpen = false;
  }

  clear(): void {
    this.root = createGroup();
    this.queryText = '';
    this.unknownFields = [];
    this.suggestions = [];
    this.recompute();
    this.searchInput?.nativeElement.focus();
  }

  applyQuery(query: string): void {
    this.queryText = query;
    const result = parseQuery(query, this.lookup);
    this.root = result.root;
    this.unknownFields = result.unknownFields;
    this.recompute();
    this.isHelpOpen = false;
    this.searchInput?.nativeElement.focus();
  }

  insertField(field: FilterField): void {
    const insert = field.kind === 'boolean' ? `is:${field.key}` : field.kind === 'number' ? `${field.key}>=` : `${field.key}:`;
    const separator = this.queryText && !/\s$/.test(this.queryText) ? ' ' : '';
    this.applyQuery(`${this.queryText}${separator}${insert}`);
    this.isHelpOpen = true;
  }

  /* ---------------------------------------------------------------- presets */

  startSavePreset(): void {
    this.isSavingPreset = true;
    this.presetName = '';
  }

  cancelSavePreset(): void {
    this.isSavingPreset = false;
  }

  onPresetNameInput(event: Event): void {
    this.presetName = (event.target as HTMLInputElement).value;
  }

  savePreset(): void {
    const name = this.presetName.trim();
    const query = this.queryText.trim();
    if (!name || !query) return;
    this.presets = [...this.presets.filter((preset) => preset.name !== name), { name, query }];
    this.persistPresets();
    this.isSavingPreset = false;
  }

  deletePreset(preset: Preset, event: Event): void {
    event.stopPropagation();
    this.presets = this.presets.filter((item) => item !== preset);
    this.persistPresets();
  }

  isPresetActive(preset: Preset): boolean {
    return preset.query === this.queryText.trim();
  }

  private loadPresets(): Preset[] {
    try {
      const parsed = JSON.parse(localStorage.getItem(PRESET_STORAGE_KEY) ?? '[]') as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((item): item is Preset =>
        !!item && typeof item === 'object' && typeof (item as Preset).name === 'string' && typeof (item as Preset).query === 'string'
      );
    } catch {
      return [];
    }
  }

  private persistPresets(): void {
    try {
      localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(this.presets));
    } catch {
      // Storage may be unavailable (private mode); presets just stay in memory.
    }
  }

  /* -------------------------------------------------------------- lifecycle */

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.isHelpOpen) return;
    const target = event.target as Node;
    if (!this.host.nativeElement.querySelector('.help-popover')?.contains(target)
      && !this.host.nativeElement.querySelector('.help-button')?.contains(target)) {
      this.isHelpOpen = false;
    }
  }

  private recompute(): void {
    if (!this.engine) {
      this.matchCount = 0;
      this.ruleCounts = new Map();
      this.filtered.emit([]);
      return;
    }
    const rows = this.isActive ? this.engine.filter(this.root) : this.rows;
    this.matchCount = rows.length;
    this.ruleCounts = this.computeRuleCounts(this.root);
    this.filtered.emit(rows);
  }

  private computeRuleCounts(node: FilterNode, into = new Map<string, number>()): Map<string, number> {
    if (!this.engine) return into;
    if (node.type === 'rule') {
      into.set(node.id, this.engine.count(node));
    } else {
      for (const child of node.children) this.computeRuleCounts(child, into);
    }
    return into;
  }
}
