import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, Input, OnChanges, ViewChild } from '@angular/core';

import type { PlayerCompletion, SaveSetSummary } from '../save-parser.service';
import { Category, CompletionData, CompletionSummary, TrackedGroup, TrackedItem, WorldProgress, summarize } from './completion-model';
import { TrackerMapComponent } from './tracker-map.component';
import { CATEGORY_ICONS, objectiveKey } from './tracker-map-model';
import { loadCompletionData } from './completion-data';
import { TabDiscovery } from '../tab-discovery';
import { workIcon } from '../trait-icons';
import { OfflineImageService } from '../offline-image.service';
import { Game8LookupService } from '../game8-lookup.service';
import { palImagePath } from '../pal-image';
import { palWikiLinks, PalWikiLink } from '../pal-wiki-links';

interface PlayerOption {
  key: string;
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
  imports: [CommonModule, TrackerMapComponent],
  templateUrl: './completion.component.html',
  styleUrls: ['../pal-wiki-links.css', './completion.component.css']
})
export class CompletionComponent implements OnChanges {
  @Input() sets: SaveSetSummary[] = [];

  /** Master lists; loaded once from resources/completion/completion-data.json. */
  data: CompletionData | null = null;
  loadError = '';
  players: PlayerOption[] = [];
  selectedPlayer = '';
  summary: CompletionSummary | null = null;
  selectedCategory = '';
  search = '';
  groupFilter = '';
  mapOpen = false;
  mapVisited = false;
  categoryIcons: Record<string, string> = {};
  private mapIcons: Record<string, string> = {};
  private readonly tabDiscovery = new TabDiscovery();
  private readonly palNumberSuffixes = new Map<string, Promise<string>>();
  private readonly palLinks = new Map<string, PalWikiLink[]>();
  get isPalList(): boolean {
    return this.selectedCategory === 'paldeck' || this.selectedCategory === 'captureBonus';
  }

  palIcon(item: TrackedItem): Promise<string> {
    return this.images.load(palImagePath(item.id, item.id));
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
  mapFocus = '';
  readonly ringCircumference = 2 * Math.PI * RING_RADIUS;

  constructor(private readonly changeDetector: ChangeDetectorRef, private readonly images: OfflineImageService, private readonly palLookup: Game8LookupService) {
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

  ngOnChanges(): void {
    const players: PlayerOption[] = [];
    for (const set of this.sets) {
      for (const player of set.players) {
        if (!player.completion) continue;
        players.push({
          key: `${set.folder}|${player.uid}`,
          label: player.name || `Player ...${player.uid.replace(/-/g, '').slice(-4)}`,
          letter: set.letter,
          save: set.label,
          completion: player.completion,
          world: { labs: set.labs ?? [] },
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
    return category.items.filter((item) =>
      (!this.groupFilter || item.group === this.groupFilter)
      && (!needle || item.name.toLowerCase().includes(needle) || item.detail.toLowerCase().includes(needle) || item.coords.includes(needle)));
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
    this.selectedCategory = this.selectedCategory === key ? '' : key;
    this.groupFilter = '';
    this.search = '';
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

  showMapCategory(key: string): void {
    this.mapOpen = false;
    this.selectedCategory = key;
    this.groupFilter = ''; this.search = '';
    requestAnimationFrame(() => document.querySelector('.category-detail')?.scrollIntoView({ block: 'nearest' }));
  }

  setGroup(key: string): void {
    this.groupFilter = this.groupFilter === key ? '' : key;
  }

  onSearch(event: Event): void {
    this.search = (event.target as HTMLInputElement).value;
  }

  stateLabel(item: TrackedItem): string {
    if (this.selectedCategory === 'paldeck') return item.state === 'done' ? 'Captured' : 'Never Captured';
    if (this.selectedCategory === 'captureBonus') return item.state === 'done' ? 'Captured 5' : item.state === 'active' ? 'Progressing to 5' : 'Never Captured';
    switch (item.state) {
      case 'done': return 'Done';
      case 'active': return 'In progress';
      default: return 'Missing';
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
