import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, Input, OnChanges, ViewChild } from '@angular/core';

import type { PlayerCompletion, SaveSetSummary } from '../save-parser.service';
import { Category, CompletionData, CompletionSummary, TrackedGroup, TrackedItem, WorldProgress, summarize } from './completion-model';
import { TrackerMapComponent } from './tracker-map.component';
import { CATEGORY_ICONS, objectiveKey } from './tracker-map-model';
import { loadCompletionData } from './completion-data';
import { TabDiscovery } from '../tab-discovery';
import { workIcon } from '../trait-icons';
import { OfflineImageDirective } from '../offline-image.directive';
import { StickyTableHeaderDirective } from './sticky-table-header.directive';
import { TableRowViewport, TableRowViewportDirective } from './table-row-viewport.directive';
import { Game8LookupService } from '../game8-lookup.service';
import { palImagePath } from '../pal-image';
import { palWikiLinks, PalWikiLink } from '../pal-wiki-links';
import { TooltipDirective } from '../game-tooltip.component';
import { ownedCondensation } from './owned-condensation';

interface PlayerOption {
  key: string;
  folder: string;
  label: string;
  letter: string;
  save: string;
  completion: PlayerCompletion;
  world: WorldProgress;
  level: number | null;
  percent: number | null;
}

/** Radius of the overall progress ring in its 120x120 view box. */
const RING_RADIUS = 52;

@Component({
  selector: 'app-completion',
  standalone: true,
  imports: [CommonModule, TrackerMapComponent, OfflineImageDirective, StickyTableHeaderDirective, TableRowViewportDirective, TooltipDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './completion.component.html',
  styleUrls: ['../pal-wiki-links.css', './completion.component.css']
})
export class CompletionComponent implements OnChanges {
  @Input() sets: SaveSetSummary[] = [];
  @Input() rows: Record<string, unknown>[] = [];
  readonly condensationStars = [0, 1, 2, 3, 4];

  /** Master lists; loaded once from resources/completion/completion-data.json. */
  data: CompletionData | null = null;
  loadError = '';
  players: PlayerOption[] = [];
  selectedPlayer = '';
  summary: CompletionSummary | null = null;
  selectedCategory = '';
  search = '';
  groupFilter = '';
  prioritizeNotDone = true;
  headerPinned = false;
  mapOpen = false;
  mapVisited = false;
  categoryIcons: Record<string, string> = {};
  readonly rarityNames = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'];
  private mapIcons: Record<string, string> = {};
  private readonly tabDiscovery = new TabDiscovery();
  private readonly palNumberSuffixes = new Map<string, Promise<string>>();
  private readonly palLinks = new Map<string, PalWikiLink[]>();
  private readonly localDataOwners = new Map<string, string>();
  private readonly orderedRows = new WeakMap<Category, { normal: TrackedItem[]; prioritized: TrackedItem[] }>();
  private filteredRows?: { category: Category; needle: string; group: string; priority: boolean; items: TrackedItem[] };
  get isPalList(): boolean {
    return this.selectedCategory === 'paldeck' || this.selectedCategory === 'captureBonus';
  }

  palIconPath(item: TrackedItem): string {
    return palImagePath(item.id, item.id);
  }

  wikiLinks(item: TrackedItem): PalWikiLink[] {
    const key = `${item.id}:${item.name}`;
    let links = this.palLinks.get(key);
    if (!links) {
      links = palWikiLinks(item.name);
      this.palLinks.set(key, links);
      void this.palLookup.urlFor(item.name).then(url => {
        if (url) this.palLinks.set(key, palWikiLinks(item.name, url));
        this.changeDetector.markForCheck();
      });
    }
    return links;
  }

  trackWikiLink(_index: number, link: PalWikiLink): string { return link.site; }

  palNumberSuffix(item: TrackedItem): Promise<string> {
    let suffix = this.palNumberSuffixes.get(item.id);
    if (!suffix) {
      suffix = this.palLookup.numberFor(item.name).then(number => {
        const match = /^(\d+)([A-Za-z]*)$/.exec(number);
        return match && Number(match[1]) === item.no ? match[2].toUpperCase() : '';
      });
      this.palNumberSuffixes.set(item.id, suffix);
    }
    return suffix;
  }

  get showMapPing(): boolean {
    return this.tabDiscovery.shouldPing('map', this.mapOpen ? 'map' : null, this.summary !== null);
  }
  @ViewChild(TrackerMapComponent) trackerMap?: TrackerMapComponent;
  @ViewChild('trackerScroll') trackerScroll?: ElementRef<HTMLElement>;
  @ViewChild('categoryDetail') categoryDetail?: ElementRef<HTMLElement>;
  mapFocus = '';
  readonly ringCircumference = 2 * Math.PI * RING_RADIUS;

  constructor(private readonly changeDetector: ChangeDetectorRef, private readonly palLookup: Game8LookupService, private readonly rowViewport: TableRowViewport) {
    void this.loadData();
    void this.loadCategoryIcons();
  }

  private async loadCategoryIcons(): Promise<void> {
    try {
      const response = await fetch(new URL('resources/completion/maps/icons.json', document.baseURI));
      if (!response.ok) return;
      const paths: Record<string, string> = await response.json();
      const sources = new Map<string, string>();
      await Promise.allSettled(Object.entries(paths).map(async ([name, path]) => {
        const image = await fetch(new URL(path, document.baseURI));
        if (image.ok) sources.set(name, (await image.text()).trim());
      }));
      this.mapIcons = Object.fromEntries(sources);
      this.categoryIcons = Object.fromEntries(Object.entries(CATEGORY_ICONS)
        .filter(([, name]) => sources.has(name)).map(([category, name]) => [category, sources.get(name)!]));
      this.categoryIcons['crafting'] = workIcon('Handcraft');
      this.changeDetector.markForCheck();
    } catch { /* Decorative icons must not prevent the tracker from loading. */ }
  }

  groupIcon(category: string, group: Pick<TrackedGroup, 'key' | 'name'>): string | undefined {
    if (category === 'research') return workIcon(group.key);
    if (category === 'technologies') {
      return this.mapIcons[group.key === 'ancient' ? 'Ancient Technology' : 'Technology'];
    }
    if (category === 'relics') return this.mapIcons[group.name];
    if (category === 'fastTravel') {
      return this.mapIcons[group.key === 'statue' ? 'Fast Travel' : 'Watchtower'];
    }
    return undefined;
  }

  itemIcon(category: string, item: TrackedItem): string | undefined {
    if (category === 'technologies') {
      return this.mapIcons[item.group === 'ancient' ? 'Ancient Technology' : 'Technology'];
    }
    const name = category === 'relics' ? item.name
      : category === 'statue' ? this.data?.relicTypes.find(type => type.enum === item.id)?.item : undefined;
    return name ? this.mapIcons[name] : undefined;
  }

  onRecipeToggle(): void {
    this.changeDetector.markForCheck();
  }

  ngOnChanges(): void {
    const players: PlayerOption[] = [];
    for (const set of this.sets) {
      for (const player of set.players) {
        if (!player.completion) continue;
        players.push({
          key: `${set.folder}|${player.uid}`,
          folder: set.folder,
          label: player.name || `Player ...${player.uid.replace(/-/g, '').slice(-4)}`,
          letter: set.letter,
          save: set.label,
          completion: player.completion,
          world: {
            labs: set.labs ?? [],
            ownedCondensation: set.has_level ? ownedCondensation(this.rows, set.letter, player.uid) : null,
            bases: set.has_level ? set.bases.length : null,
            pals: set.has_level || set.has_dimensional_storage ? set.pals : null,
            keyItems: player.key_items,
            attributes: player.attributes,
            attributesUnavailable: set.has_level ? 'Player attributes were not recorded in the loaded world save.' : 'Add Level.sav with "+ Files" to see player attributes.',
            seenSpecies: this.localDataOwner(set) === player.uid ? set.seen_species : null,
            checkedNotes: this.localDataOwner(set) === player.uid ? set.checked_notes : null,
            checkedUnavailable: !set.has_local_data ? 'Add LocalData.sav with "+ Files" to see checked journals.'
              : set.checked_notes == null ? 'Journal check data unavailable. Load one matching LocalData.sav with recorded journal checks.'
              : 'Select the player who owns LocalData.sav. Checked journals are only available for that player.',
            seenUnavailable: !set.has_local_data ? 'Add LocalData.sav with "+ Files" to see encountered species.'
              : set.seen_species == null ? 'Encounter data unavailable. Load one matching LocalData.sav.'
              : 'Select the player who owns LocalData.sav. Seen data is only available for that player.',
          },
          level: player.level ?? null,
          percent: null,
        });
      }
    }
    this.players = players;
    if (!players.some((player) => player.key === this.selectedPlayer)) this.selectedPlayer = '';
    this.recompute();
  }

  get player(): PlayerOption | null {
    return this.players.find((player) => player.key === this.selectedPlayer) ?? null;
  }

  get category(): Category | null {
    return this.summary?.categories.find((category) => category.key === this.selectedCategory) ?? null;
  }

  /** Items of the open category after the group chips and search. */
  get visibleItems(): TrackedItem[] {
    const category = this.category;
    if (!category) return [];
    const needle = this.search.trim().toLowerCase();
    const previous = this.filteredRows;
    if (previous?.category === category && previous.needle === needle && previous.group === this.groupFilter && previous.priority === this.prioritizeNotDone) return previous.items;
    let ordered = this.orderedRows.get(category);
    if (!ordered) {
      const normal = [...category.items].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
      const prioritized = category.key === 'mainQuests' || category.key === 'sideQuests'
        ? [...normal.filter(item => item.state === 'active'), ...normal.filter(item => item.state === 'todo'), ...normal.filter(item => item.state === 'done')]
        : [...normal.filter(item => item.state !== 'done'), ...normal.filter(item => item.state === 'done')];
      ordered = { normal, prioritized };
      this.orderedRows.set(category, ordered);
    }
    const items = (this.prioritizeNotDone ? ordered.prioritized : ordered.normal).filter((item) =>
      (!this.groupFilter || item.group === this.groupFilter)
      && (!needle || item.name.toLowerCase().includes(needle) || item.detail.toLowerCase().includes(needle) || item.coords.includes(needle)));
    this.filteredRows = { category, needle, group: this.groupFilter, priority: this.prioritizeNotDone, items };
    return items;
  }

  get tableColumnCount(): number {
    const category = this.category;
    return 3 + (category?.key === 'crafting' ? 8 : 0) + (this.isPalList ? 1 : 0)
      + (category?.key === 'paldeck' || category?.key === 'notes' ? 1 : 0)
      + (category?.key === 'captureBonus' ? 2 + this.condensationStars.length : 0) + (this.showFishing ? 3 : 0)
      + (category?.hasCoords ? 1 : 0) + (category?.hasNumbers ? 1 : 0) + (category?.hasTags ? 1 : 0);
  }

  get localDataSave(): SaveSetSummary | undefined { return this.sets.find(set => set.folder === this.player?.folder); }

  localDataOwner(set: SaveSetSummary): string {
    const selected = this.localDataOwners.get(set.folder);
    return selected && set.players.some(player => player.uid === selected) ? selected : set.players.length === 1 ? set.players[0].uid : '';
  }

  selectLocalDataOwner(event: Event): void {
    const set = this.localDataSave;
    if (!set) return;
    this.localDataOwners.set(set.folder, (event.target as HTMLSelectElement).value);
    this.ngOnChanges();
  }

  get showFishing(): boolean {
    return this.selectedCategory === 'captureBonus' && this.visibleItems.some(item => item.fishing !== undefined);
  }

  get isMaxLevel(): boolean {
    const level = this.player?.level;
    return level !== null && level !== undefined && this.data !== null && level >= this.data.maxLevel;
  }

  get ringOffset(): number {
    const percent = this.summary?.percent ?? 0;
    return this.ringCircumference * (1 - Math.min(100, Math.max(0, percent)) / 100);
  }

  selectPlayer(key: string): void {
    if (key === this.selectedPlayer) return;
    this.selectedPlayer = key;
    this.mapFocus = '';
    this.recompute();
  }

  selectCategory(key: string): void {
    this.trackerScroll?.nativeElement.scrollTo({ left: 0 });
    this.headerPinned = false;
    this.selectedCategory = this.selectedCategory === key ? '' : key;
    this.groupFilter = '';
    this.search = '';
  }

  scrollToCardTop(): void {
    const section = this.categoryDetail?.nativeElement;
    const container = this.trackerScroll?.nativeElement;
    if (!section || !container) return;
    section.focus({ preventScroll: true });
    const inset = Number.parseFloat(getComputedStyle(container).paddingTop) || 0;
    const top = container.scrollTop + section.getBoundingClientRect().top
      - container.getBoundingClientRect().top - container.clientTop - inset;
    container.scrollTo({
      top: Math.max(0, top), left: 0,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    });
  }

  showMap(item?: TrackedItem): void {
    this.tabDiscovery.visit('map', this.summary !== null);
    if (item) this.mapFocus = objectiveKey(this.selectedCategory, item.id);
    this.mapVisited = true;
    this.mapOpen = true;
    if (item) requestAnimationFrame(() => {
      this.trackerMap?.focusObjective(this.mapFocus);
      document.querySelector('app-tracker-map')?.scrollIntoView({ block:'start' });
    });
  }

  showMapCategory(key: string, itemId?: string): void {
    this.mapOpen = false;
    this.headerPinned = false;
    this.selectedCategory = key;
    this.groupFilter = ''; this.search = '';
    requestAnimationFrame(() => {
      if (this.mapOpen || this.selectedCategory !== key) return;
      const section = this.categoryDetail?.nativeElement;
      const container = this.trackerScroll?.nativeElement;
      if (!section || !container) return;
      const row = itemId === undefined ? undefined : Array.from(section.querySelectorAll<HTMLElement>('tbody tr[data-item-id]'))
        .find(row => row.dataset['itemId'] === itemId);
      if (!row) {
        section.scrollIntoView({ block: 'nearest' });
        return;
      }
      this.rowViewport.reveal(row);
      container.scrollTo({
        top: container.scrollTop + row.getBoundingClientRect().top - container.getBoundingClientRect().top
          - (container.clientHeight - row.offsetHeight) / 2,
        left: 0, behavior: 'instant',
      });
      row.focus({ preventScroll: true });
      row.classList.add('map-highlight');
      row.addEventListener('animationend', () => row.classList.remove('map-highlight'), { once: true });
    });
  }

  setGroup(key: string): void {
    this.groupFilter = this.groupFilter === key ? '' : key;
  }

  onSearch(event: Event): void {
    this.search = (event.target as HTMLInputElement).value;
  }

  stateLabel(item: TrackedItem): string {
    if (this.selectedCategory === 'crafting') return item.crafting?.count == null ? 'Unknown' : item.state === 'done' ? 'Crafted' : 'Not crafted';
    if (this.selectedCategory === 'paldeck') return item.state === 'done' ? 'Captured' : 'Never Captured';
    if (this.selectedCategory === 'captureBonus') return item.state === 'done' ? 'Captured 5' : item.state === 'active' ? 'Progressing to 5' : 'Never Captured';
    if (this.selectedCategory === 'notes') return item.state === 'done' ? 'Read' : item.state === 'active' ? 'Not Read' : 'Missing';
    if (item.state === 'active') return 'In progress';
    const done = item.state === 'done';
    switch (this.selectedCategory) {
      case 'technologies':
      case 'fastTravel': return done ? 'Unlocked' : 'Locked';
      case 'research': return done ? 'Researched' : 'Not Researched';
      case 'skins':
      case 'ruins':
      case 'relics': return done ? 'Obtained' : 'Missing';
      case 'areas': return done ? 'Visited' : 'Not Visited';
      case 'towers':
      case 'towersHard':
      case 'raids':
      case 'alphas':
      case 'bounties': return done ? 'Defeated' : 'Undefeated';
      default: return done ? 'Done' : 'Missing';
    }
  }

  trackPlayer(_index: number, player: PlayerOption): string {
    return player.key;
  }

  trackCategory(_index: number, category: Category): string {
    return category.key;
  }

  trackItem(_index: number, item: TrackedItem): string {
    return item.id;
  }

  percentTone(percent: number | null): string {
    if (percent === null) return '';
    if (percent >= 90) return 'high';
    if (percent >= 50) return 'mid';
    return 'low';
  }

  private recompute(): void {
    if (this.data) {
      for (const option of this.players) option.percent = summarize(option.completion, this.data, option.world).percent;
      if (!this.player) {
        const best = this.players.reduce<PlayerOption | null>((best, option) =>
          !best || option.percent! > best.percent! ? option : best, null);
        this.selectedPlayer = best?.key ?? '';
      }
    }
    const player = this.player;
    this.summary = player && this.data ? summarize(player.completion, this.data, player.world) : null;

    if (this.summary && !this.summary.categories.some((category) => category.key === this.selectedCategory)) this.selectedCategory = '';
  }

  private async loadData(): Promise<void> {
    try {
      this.data = await loadCompletionData();
    } catch (error) {
      this.loadError = error instanceof Error ? error.message : 'Could not load the completion data.';
    }
    this.recompute();
    this.changeDetector.markForCheck();
  }
}
