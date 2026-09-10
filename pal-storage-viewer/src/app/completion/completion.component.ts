import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, Input, OnChanges, ViewChild } from '@angular/core';

import type { PlayerCompletion, SaveSetSummary } from '../save-parser.service';
import { Category, CompletionData, CompletionSummary, TrackedGroup, TrackedItem, WorldProgress, summarize } from './completion-model';
import { TrackerMapComponent } from './tracker-map.component';
import { CATEGORY_ICONS, objectiveKey } from './tracker-map-model';
import { loadCompletionData } from './completion-data';
import { TabDiscovery } from '../tab-discovery';

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
  styleUrl: './completion.component.css'
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

  get showMapPing(): boolean {
    return this.tabDiscovery.shouldPing('map', this.mapOpen ? 'map' : null, this.summary !== null);
  }
  @ViewChild(TrackerMapComponent) trackerMap?: TrackerMapComponent;
  mapFocus = '';
  readonly ringCircumference = 2 * Math.PI * RING_RADIUS;

  constructor(private readonly changeDetector: ChangeDetectorRef) {
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

  groupIcon(category: string, group: TrackedGroup): string | undefined {
    if (category === 'relics') return this.mapIcons[group.name];
    if (category === 'fastTravel') {
      return this.mapIcons[group.key === 'statue' ? 'Fast Travel' : 'Watchtower'];
    }
    return undefined;
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
    if (!players.some((player) => player.key === this.selectedPlayer)) this.selectedPlayer = players[0]?.key ?? '';
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
    const player = this.player;
    if (this.data) {
      for (const option of this.players) option.percent = summarize(option.completion, this.data, option.world).percent;
    }
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
