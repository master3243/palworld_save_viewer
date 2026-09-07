import { CommonModule } from '@angular/common';
import { hasMultipleOwners, shortOwner } from '../pal-owners';
import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild
} from '@angular/core';

import { OfflineImageService } from '../offline-image.service';
import { GameDataService } from '../game-data.service';
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
  SortCriterion,
  cycleSort,
  buildFieldRegistry,
  countActiveRules,
  createGroup,
  createRule,
  isEmptyTree,
  operatorDef,
  rulesEqual
} from './filter-model';
import { completionContext, parseQuery, quoteValue, serializeQuery } from './filter-query';
import { MoveCatalog } from './move-filters';

export interface FilterResult { rows: PalStorageRow[]; sorts: SortCriterion[]; sortedColumns: Set<string>; }

interface ChipState {
  /** Label shown while this state is active. */
  label: string;
  title: string;
  tone: 'include' | 'exclude' | 'female' | 'male' | 'favorite';
  /** Optional asset path for an icon shown before the label. */
  icon?: string;
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
export class FilterBarComponent implements OnChanges, AfterViewInit, OnDestroy {
  @Input() rows: PalStorageRow[] = [];
  @Output() filtered = new EventEmitter<FilterResult>();

  @ViewChild('searchInput') searchInput?: ElementRef<HTMLInputElement>;
  @ViewChild('chipScroller') chipScroller!: ElementRef<HTMLElement>;
  @ViewChild('chipTrack') chipTrack!: ElementRef<HTMLElement>;
  canScrollChipsLeft = false;
  canScrollChipsRight = false;
  private chipResizeObserver?: ResizeObserver;

  ngAfterViewInit(): void {
    this.chipResizeObserver = new ResizeObserver(() => this.updateChipScroll());
    this.chipResizeObserver.observe(this.chipScroller.nativeElement);
    this.chipResizeObserver.observe(this.chipTrack.nativeElement);
  }

  ngOnDestroy(): void {
    this.chipResizeObserver?.disconnect();
  }

  updateChipScroll(): void {
    const el = this.chipScroller.nativeElement;
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    if (left === this.canScrollChipsLeft && right === this.canScrollChipsRight) return;
    this.zone.run(() => {
      this.canScrollChipsLeft = left;
      this.canScrollChipsRight = right;
    });
  }

  scrollChips(direction: number): void {
    const el = this.chipScroller.nativeElement;
    el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: 'smooth' });
  }

  root: FilterGroup = createGroup();
  sorts: SortCriterion[] = [];
  fields: FilterField[] = [];
  lookup = new FieldLookup([]);
  engine: FilterEngine | null = null;
  ruleCounts = new Map<string, number>();

  queryText = '';
  unknownFields: string[] = [];
  /** Problems with the typed query; shown in red under the box. */
  queryErrors: string[] = [];
  matchCount = 0;
  isPanelOpen = false;
  isHelpOpen = false;
  isSavingPreset = false;
  presetName = '';
  presets: Preset[] = [];

  suggestions: SearchSuggestion[] = [];
  suggestionIndex = -1;
  private suggestionsVisible = false;

  /** One state per loaded save (A, B, …); only offered when more than one save is loaded. */
  saveChip: QuickChip | null = null;
  ownerChip: QuickChip | null = null;

  get allChips(): QuickChip[] {
    return [...(this.saveChip ? [this.saveChip] : []), ...(this.ownerChip ? [this.ownerChip] : []), ...this.quickChips];
  }

  readonly quickChips: QuickChip[] = [
    {
      label: 'Where',
      title: 'Location: click to cycle party, Pal Box, bases, dimensional storage, any',
      states: [
        { label: 'Party', title: 'In the party', tone: 'include', make: () => createRule('where', 'is', ['Party']) },
        { label: 'Box', title: 'In the Pal Box', tone: 'include', make: () => createRule('where', 'is', ['Pal Box']) },
        { label: 'Base', title: 'Working at a base', tone: 'include', make: () => createRule('where', 'starts', ['Base']) },
        { label: 'DimsPS', title: 'In the Dimensional Pal Storage', tone: 'include', make: () => createRule('where', 'is', ['DimsPS']) }
      ]
    },
    flagChip('Alpha', 'Alpha pals', 'alpha'),
    flagChip('★ Lucky', 'Lucky pals', 'lucky'),
    {
      label: '♂♀',
      title: 'Gender',
      states: [
        { label: '♂', title: 'Male only', tone: 'male', make: () => createRule('gender', 'is', ['Male']) },
        { label: '♀', title: 'Female only', tone: 'female', make: () => createRule('gender', 'is', ['Female']) }
      ]
    },
    {
      label: 'Fav',
      title: 'Favorite: click to cycle any, I, II, III, none',
      states: [
        { label: 'Fav', title: 'Any favorite', tone: 'include', make: () => createRule('favorite', 'is_true') },
        { label: 'Fav', title: 'Favorite I', tone: 'favorite', icon: 'assets/ui/fav1.pog', make: () => createRule('fav_slot', 'eq', ['1']) },
        { label: 'Fav', title: 'Favorite II', tone: 'favorite', icon: 'assets/ui/fav2.pog', make: () => createRule('fav_slot', 'eq', ['2']) },
        { label: 'Fav', title: 'Favorite III', tone: 'favorite', icon: 'assets/ui/fav3.pog', make: () => createRule('fav_slot', 'eq', ['3']) },
        { label: 'Fav', title: 'Not a favorite', tone: 'exclude', make: () => createRule('favorite', 'is_false') }
      ]
    },
    numberChip('4★', 'Max rank (4 stars)', 'rank', 'eq', ['4']),
    numberChip('=300 IV', 'Perfect IVs (100 / 100 / 100)', 'iv', 'eq', ['300']),
    numberChip('60 SR', 'Max HP + Attack + Defense soul rank', 'sr_combat', 'eq', ['60']),
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
    { query: 'hp_pct<50', meaning: 'less than half HP; hp refers to IV HP, current_hp to health' },
    { query: 'current_hp<max_hp', meaning: 'compare two fields on the same Pal' },
    { query: 'current_hp<max_hp/2', meaning: 'compare with a formula (+, −, *, / and parentheses)' },
    { query: 'equipped_type:Dark', meaning: 'has an equipped Dark move' },
    { query: 'known_type:Dark', meaning: 'has a known Dark move, equipped or available to equip' },
    { query: 'equipped_move:(type:Dark power>=100)', meaning: 'one equipped move must meet both conditions' },
    { query: 'known_move!=(effect:Burn)', meaning: 'no known move causes Burn' },
    { query: 'sort:-level,-iv,pal', meaning: 'level descending, then IV total descending, then name' },
    { query: 'anubis', meaning: 'name, nickname, passive or move contains "anubis"' },
    { query: 'level>=40 atk>=90', meaning: 'both conditions (space means AND)' },
    { query: 'hp>=90 OR def>=90', meaning: 'either condition' },
    { query: 'skills:Legend,Musclehead', meaning: 'has all of these passives' },
    { query: 'skills:Legend|Musclehead', meaning: 'has any of these passives' },
    { query: 'work:mining,handiwork type:fire', meaning: 'work suitabilities and element types work the same way' },
    { query: '-skills:Brittle', meaning: 'does not have this passive' },
    { query: 'is:alpha -is:lucky', meaning: 'yes/no flags: alpha, lucky, favorite, male, female' },
    { query: 'gender=male', meaning: '= is exact, : is contains' },
    { query: 'iv:250..300', meaning: 'between two numbers' },
    { query: 'iv_min>=80 platinum>=1', meaning: 'derived stats: IV lowest, passive tier counts' },
    { query: 'nick:*', meaning: 'has a nickname (field is set)' },
    { query: 'pal~"^Jet"', meaning: 'regular expression' },
    { query: '(hp>=90 OR def>=90) -(is:alpha OR level<20)', meaning: 'parentheses and NOT groups' }
  ];

  iconSources: Record<string, string> = {};

  constructor(
    private readonly host: ElementRef<HTMLElement>,
    private readonly zone: NgZone,
    private readonly offlineImages: OfflineImageService,
    private readonly gameData: GameDataService
  ) {
    this.presets = this.loadPresets();
    for (const chip of this.quickChips) {
      for (const state of chip.states) {
        if (!state.icon) continue;
        const path = state.icon;
        void this.offlineImages.load(path).then((source) => { this.iconSources[path] = source; });
      }
    }
  }

  chipIcon(chip: QuickChip): string {
    const icon = this.chipState(chip)?.icon;
    return icon ? this.iconSources[icon] ?? '' : '';
  }

  get total(): number {
    return this.rows.length;
  }

  get isActive(): boolean {
    return !isEmptyTree(this.root);
  }

  get hasCriteria(): boolean { return this.isActive || this.sorts.length > 0; }

  get activeRuleCount(): number {
    return countActiveRules(this.root);
  }

  fieldGroups: Array<{ name: string; fields: FilterField[] }> = [];

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['rows']) return;
    const letters = Array.from(new Set(this.rows.map((row) => String(row['save_id'] ?? '')).filter(Boolean)))
      .sort((left, right) => left.length - right.length || left.localeCompare(right));
    this.saveChip = letters.length ? {
      label: 'File',
      title: 'File: click to cycle through the loaded save files',
      states: letters.map((letter) => ({
        label: `File ${letter}`,
        title: `Only save files from ${letter}`,
        tone: 'include' as const,
        make: () => createRule('save', 'is', [letter])
      }))
    } : null;
    const owners = [...new Set(this.rows.map(row => String(row['owner_name'] ?? '')))]
      .sort((a, b) => a.localeCompare(b));
    this.ownerChip = hasMultipleOwners(this.rows) && owners.length > 1 ? {
      label: 'Owner',
      title: 'Owner: click to cycle through owners, then everyone',
      states: owners.map(name => ({
        label: shortOwner(name || 'Empty'),
        title: name ? `Owner: ${name}` : 'Owner: Empty',
        tone: 'include' as const,
        make: () => name ? createRule('owner', 'is', [name]) : createRule('owner', 'empty')
      }))
    } : null;
    this.setupEngine();
    const rows = this.rows;
    void this.gameData.load().then(() => {
      if (this.rows !== rows) return;
      this.setupEngine();
      this.recompute();
    });

    this.suggestions = [];
    this.queryText = '';
    this.root = createGroup();
    this.sorts = [];
    this.unknownFields = [];
    this.queryErrors = [];
    void Promise.resolve().then(() => this.recompute());
  }

  private setupEngine(): void {
    const moves = new MoveCatalog(id => this.gameData.activeDetail(id));
    this.fields = buildFieldRegistry(this.rows, moves);
    this.lookup = new FieldLookup(this.fields);
    const groups = new Map<string, FilterField[]>();
    for (const field of this.fields) {
      const list = groups.get(field.group) ?? [];
      list.push(field);
      groups.set(field.group, list);
    }
    this.fieldGroups = Array.from(groups, ([name, fields]) => ({ name, fields }));
    this.engine = this.rows.length ? new FilterEngine(this.lookup, this.rows, moves) : null;
  }

  fieldForColumn(key: string): FilterField | undefined {
    const mapped: Record<string, string> = { hp: 'current_hp', attack: 'attack_stat', defense: 'defense_stat', save: 'save_name' };
    return this.lookup.resolve(mapped[key] ?? key);
  }

  sortForColumn(key: string): SortCriterion | undefined { return this.sorts.find(sort => sort.field === this.fieldForColumn(key)?.key); }

  toggleSort(key: string, additive: boolean): void {
    const field = this.fieldForColumn(key);
    if (!field) return;
    this.sorts = cycleSort(this.sorts, field.key, additive);
    this.onTreeChanged();
  }

  /* ------------------------------------------------------------- search box */

  onQueryInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.queryText = input.value;
    const result = parseQuery(this.queryText, this.lookup);
    this.root = result.root;
    this.sorts = result.sorts;
    this.unknownFields = result.unknownFields;
    this.queryErrors = result.errors;
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
    this.sorts = result.sorts;
    this.unknownFields = result.unknownFields;
    this.queryErrors = result.errors;
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

    const before = this.queryText.slice(0, context.termStart);
    const inMoveGroup = /(?:equipped|known|unlearned)_moves?(?:!=|:|=)\s*\([^)]*$/i.test(before);
    const lookup = inMoveGroup ? this.engine.moveLookup : this.lookup;
    if (context.mode === 'field') {
      if (!context.prefix) {
        this.suggestions = [];
        return;
      }
      const isPrefix = 'is'.startsWith(context.prefix.toLowerCase());
      const fields = lookup.complete(context.prefix).slice(0, 8).map((field) => ({
        kind: 'field' as const,
        insert: field.kind === 'boolean' ? `is:${field.key}` : field.kind === 'number' ? `${field.key}>=` : `${field.key}:`,
        label: field.key,
        detail: field.label + (field.kind === 'number' ? ' (number)' : field.kind === 'boolean' ? ' (yes/no)' : '')
      }));
      this.suggestions = isPrefix
        ? [{ kind: 'field', insert: 'is:', label: 'is:', detail: 'alpha, lucky, favorite, male, female…' }, ...fields]
        : fields;
      if (!inMoveGroup) {
        const groups = ['equipped', 'known', 'unlearned'].filter(scope => `${scope}_move`.startsWith(context.prefix.toLowerCase())).map(scope => ({ kind: 'field' as const, insert: `${scope}_move:(`, label: `${scope}_move:(…)`, detail: 'Match properties of the same move' }));
        if ('sort'.startsWith(context.prefix.toLowerCase())) groups.push({ kind: 'field', insert: 'sort:', label: 'sort:', detail: 'Ordered sort fields; − means descending' });
        this.suggestions = [...groups, ...this.suggestions].slice(0, 10);
      }
      return;
    }

    const fieldName = context.field?.toLowerCase() ?? '';
    if (fieldName === 'sort') {
      const descending = context.prefix.startsWith('-');
      this.suggestions = this.lookup.complete(context.prefix.replace(/^[-+]/, '')).filter(field => field.key !== 'any').slice(0, 8).map(field => ({ kind: 'value', insert: `${descending ? '-' : ''}${field.key}`, label: field.label, detail: descending ? 'Descending' : 'Ascending' }));
      return;
    }
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

    const field = lookup.resolve(fieldName);
    if (field?.kind === 'number') {
      const prefix = context.prefix.match(/[a-z_]\w*$/i)?.[0];
      this.suggestions = prefix ? lookup.complete(prefix).filter(field => field.kind === 'number').slice(0, 8).map(field => ({ kind: 'value', insert: context.prefix.slice(0, -prefix.length) + field.key, label: field.label, detail: 'Compare with this field' })) : [];
      return;
    }
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
    this.queryText = serializeQuery(this.root, this.lookup, this.sorts);
    this.unknownFields = [];
    this.queryErrors = this.engine?.errors(this.root) ?? [];
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
    this.sorts = [];
    this.queryText = '';
    this.unknownFields = [];
    this.queryErrors = [];
    this.suggestions = [];
    this.recompute();
    this.searchInput?.nativeElement.focus();
  }

  applyQuery(query: string): void {
    this.queryText = query;
    const result = parseQuery(query, this.lookup);
    this.root = result.root;
    this.sorts = result.sorts;
    this.unknownFields = result.unknownFields;
    this.queryErrors = result.errors;
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
    if (!name || !query || this.queryErrors.length) return;
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
      this.filtered.emit({ rows: [], sorts: [], sortedColumns: new Set() });
      return;
    }
    if (this.queryErrors.length) return;
    this.queryErrors = this.engine.errors(this.root);
    if (this.queryErrors.length) return;
    const rows = this.isActive ? this.engine.filter(this.root) : this.rows;
    this.matchCount = rows.length;
    this.ruleCounts = this.computeRuleCounts(this.root);
    const sortedColumns = new Set<string>();
    for (const key of Object.keys(this.rows[0] ?? {})) if (this.sortForColumn(key)) sortedColumns.add(key);
    this.filtered.emit({ rows: this.engine.sort(rows, this.sorts), sorts: this.sorts.map(sort => ({ ...sort })), sortedColumns });
  }

  private computeRuleCounts(node: FilterNode, into = new Map<string, number>(), scope?: FilterGroup['scope']): Map<string, number> {
    if (!this.engine) return into;
    if (node.type === 'rule') {
      into.set(node.id, this.engine.count(scope ? { ...createGroup('and', [node]), scope, match: 'any' } : node));
    } else {
      for (const child of node.children) this.computeRuleCounts(child, into, node.scope ?? scope);
    }
    return into;
  }
}
