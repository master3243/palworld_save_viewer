import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, Input, OnChanges } from '@angular/core';

import type { PlayerCompletion, SaveSetSummary } from '../save-parser.service';
import { Category, CompletionData, CompletionSummary, TrackedItem, WorldProgress, summarize } from './completion-model';

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
  imports: [CommonModule],
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
  readonly ringCircumference = 2 * Math.PI * RING_RADIUS;

  private static dataPromise?: Promise<CompletionData>;

  constructor(private readonly changeDetector: ChangeDetectorRef) {
    void this.loadData();
  }

  ngOnChanges(): void {
    const players: PlayerOption[] = [];
    for (const set of this.sets) {
      for (const player of set.players) {
        if (!player.completion) continue;
        players.push({
          key: `${set.folder}|${player.uid}`,
          label: player.name || `Player …${player.uid.replace(/-/g, '').slice(-4)}`,
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
    this.recompute();
  }

  selectCategory(key: string): void {
    this.selectedCategory = this.selectedCategory === key ? '' : key;
    this.groupFilter = '';
    this.search = '';
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
    CompletionComponent.dataPromise ??= (async () => {
      const response = await fetch(new URL('resources/completion/completion-data.json', document.baseURI));
      if (!response.ok) throw new Error(`Could not load the completion data (${response.status}).`);
      return await response.json() as CompletionData;
    })();
    try {
      this.data = await CompletionComponent.dataPromise;
    } catch (error) {
      CompletionComponent.dataPromise = undefined;
      this.loadError = error instanceof Error ? error.message : 'Could not load the completion data.';
    }
    this.recompute();
    this.changeDetector.markForCheck();
  }
}
