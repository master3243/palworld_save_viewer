import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, ElementRef, EventEmitter, Input, NgZone, OnDestroy, Output, ViewChild } from '@angular/core';

import type { SaveSetSummary, SaveSource } from './save-parser.service';
import { kindBlurb, kindTag, kindTitle, savedAtLabel, shortFileName, sourceTitle } from './save-file-labels';

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

  constructor(private readonly zone: NgZone) {}

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
  @Output() readonly toggle = new EventEmitter<void>();
  @Output() readonly addFiles = new EventEmitter<void>();
  @Output() readonly removeSource = new EventEmitter<number>();
  @Output() readonly removeGroup = new EventEmitter<SourceGroup>();

  readonly kindTitle = kindTitle;
  readonly kindBlurb = kindBlurb;
  readonly shortFileName = shortFileName;
  readonly sourceTitle = sourceTitle;

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
