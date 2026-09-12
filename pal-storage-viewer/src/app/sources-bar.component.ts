import { CommonModule } from '@angular/common';
import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, EventEmitter, Input, NgZone, OnDestroy, Output, ViewChild } from '@angular/core';

import type { SaveSetSummary, SaveSource } from './save-parser.service';
import { kindTag, kindTitle, savedAtLabel, shortFileName, sourceBlurb, sourcePlayer, sourceTitle } from './save-file-labels';
import { loadCompletionData } from './completion/completion-data';
import { CompletionData, summarize } from './completion/completion-model';

/** The files of one save set, as shown in the sources bar. */
export interface SourceGroup {
  set: SaveSetSummary | null;
  folder: string;
  sources: { source: SaveSource; index: number }[];
  pals: number;
}

export interface LocationCount {
  location: string;
  count: number;
}

/** Collapsible strip above the table: loaded saves and files, add/remove controls, pal counts per location. */
@Component({
  selector: 'app-sources-bar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './sources-bar.component.html',
  styleUrl: './sources-bar.component.css'
})
export class SourcesBarComponent implements AfterViewInit, OnDestroy {
  @ViewChild('sourcesRow') sourcesRow!: ElementRef<HTMLElement>;
  @ViewChild('sourceControls') sourceControls!: ElementRef<HTMLElement>;
  @ViewChild('locationSummary') locationSummary!: ElementRef<HTMLElement>;
  locationsFit = false;
  private resizeObserver?: ResizeObserver;

  private completionData: CompletionData | null = null;
  private readonly progressCache = new WeakMap<SaveSetSummary, Map<string, number>>();

  constructor(private readonly zone: NgZone, private readonly changeDetector: ChangeDetectorRef) {
    void loadCompletionData().then(data => {
      this.completionData = data;
      this.changeDetector.markForCheck();
    }).catch(() => {
      // Keep file details available even if the tracker catalog cannot load.
    });
  }

  ngAfterViewInit(): void {
    const row = this.sourcesRow.nativeElement;
    const controls = this.sourceControls.nativeElement;
    const locations = this.locationSummary.nativeElement;
    this.resizeObserver = new ResizeObserver(() => {
      const fits = controls.getBoundingClientRect().width + 6 + locations.getBoundingClientRect().width <= row.clientWidth;
      if (fits !== this.locationsFit) this.zone.run(() => { this.locationsFit = fits; });
    });
    for (const element of [row, controls, locations]) this.resizeObserver.observe(element);
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
  }

  @Input() groups: SourceGroup[] = [];
  @Input() summary = '';
  @Input() locationCounts: LocationCount[] = [];
  @Input() open = false;
  @Input() busy = false;
  @Output() readonly toggle = new EventEmitter<void>();
  @Output() readonly addFiles = new EventEmitter<void>();
  @Output() readonly removeSource = new EventEmitter<number>();
  @Output() readonly removeGroup = new EventEmitter<SourceGroup>();

  readonly kindTitle = kindTitle;
  readonly sourceBlurb = sourceBlurb;
  readonly shortFileName = shortFileName;

  sourceTitle(source: SaveSource, set: SaveSetSummary | null): string {
    let progress: number | null = null;
    const player = source.kind === 'player' ? sourcePlayer(source, set) : undefined;
    if (set && player?.completion && this.completionData) {
      let cached = this.progressCache.get(set);
      if (!cached) {
        cached = new Map();
        this.progressCache.set(set, cached);
      }
      if (!cached.has(player.uid)) {
        cached.set(player.uid, summarize(player.completion, this.completionData, { labs: set.labs ?? [] }).percent);
      }
      progress = cached.get(player.uid)!;
    }
    return sourceTitle(source, set, progress);
  }

  sourceKindTag(source: SaveSource): string {
    return kindTag(source.kind);
  }

  /** Header details for a save group, minus anything its label already says. */
  groupMeta(group: SourceGroup): string[] {
    const set = group.set;
    const label = set?.label ?? '';
    const parts: string[] = [];
    if (set?.host_player_name) parts.push(set.host_player_name);
    if (set?.in_game_day !== null && set?.in_game_day !== undefined && !label.includes(`day ${set.in_game_day}`)) {
      parts.push(`day ${set.in_game_day}`);
    }
    if (set?.saved_at && !label.includes(set.saved_at.replace('T', ' ').slice(0, 16))) {
      parts.push(`saved ${savedAtLabel(set.saved_at)}`);
    }
    const tail = group.folder.replace(/\/+$/, '').split('/').pop() ?? '';
    if (tail && !label.includes(tail)) parts.push(tail);
    return parts;
  }
}
