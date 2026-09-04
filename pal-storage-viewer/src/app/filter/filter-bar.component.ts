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
  rulesEqual
} from './filter-model';
import { completionContext, parseQuery, quoteValue, serializeQuery } from './filter-query';

interface QuickChip {
  label: string;
  title: string;
  tone?: 'male' | 'female' | 'gold' | 'platinum' | 'negative' | 'lucky';
  make: () => FilterRule;
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
  imports: [CommonModule, FilterBuilderComponent],
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
    { label: 'Alpha', title: 'Alpha pals', make: () => createRule('alpha', 'is_true') },
    { label: '★ Lucky', title: 'Lucky pals', tone: 'lucky', make: () => createRule('lucky', 'is_true') },
    { label: '♂', title: 'Male', tone: 'male', make: () => createRule('gender', 'is', ['Male']) },
    { label: '♀', title: 'Female', tone: 'female', make: () => createRule('gender', 'is', ['Female']) },
    { label: 'Fav', title: 'Marked as favorite', make: () => createRule('favorite', 'is_true') },
    { label: '4★', title: 'Max rank (4 stars)', make: () => createRule('rank', 'eq', ['4']) },
    { label: '100 IV', title: 'At least one perfect IV', make: () => createRule('iv_max', 'eq', ['100']) },
    { label: 'IV 70+', title: 'All three IVs at 70 or more', make: () => createRule('iv_min', 'gte', ['70']) },
    { label: 'Platinum', title: 'Has a platinum tier passive', tone: 'platinum', make: () => createRule('platinum', 'gte', ['1']) },
    { label: 'Gold', title: 'Has a gold tier passive', tone: 'gold', make: () => createRule('gold', 'gte', ['1']) },
    { label: 'Negative', title: 'Has a negative passive', tone: 'negative', make: () => createRule('negative', 'gte', ['1']) },
    { label: 'Named', title: 'Has a nickname', make: () => createRule('nick', 'not_empty') }
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

    const fromHash = this.readHashQuery();
    if (fromHash) {
      this.queryText = fromHash;
      this.root = parseQuery(fromHash, this.lookup).root;
    } else {
      this.queryText = '';
      this.root = createGroup();
    }
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

  isChipActive(chip: QuickChip): boolean {
    const rule = chip.make();
    return this.root.children.some((child) => child.type === 'rule' && rulesEqual(child, rule));
  }

  toggleChip(chip: QuickChip): void {
    const rule = chip.make();
    const existing = this.root.children.find((child) => child.type === 'rule' && rulesEqual(child, rule));
    if (existing) {
      this.root.children = this.root.children.filter((child) => child !== existing);
    } else {
      if (this.root.combinator === 'or' && this.root.children.length > 1) {
        // Keep the user's OR block intact and AND the chip with it.
        this.root = createGroup('and', [this.root]);
      }
      this.root.children.push(rule);
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
    this.writeHashQuery();
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

  private readHashQuery(): string {
    const match = /^#q=(.*)$/.exec(window.location.hash);
    if (!match) return '';
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return '';
    }
  }

  private writeHashQuery(): void {
    const query = this.queryText.trim();
    const next = query ? `#q=${encodeURIComponent(query)}` : '';
    if (window.location.hash === next || (!next && !window.location.hash)) return;
    history.replaceState(null, '', `${window.location.pathname}${window.location.search}${next}`);
  }
}
