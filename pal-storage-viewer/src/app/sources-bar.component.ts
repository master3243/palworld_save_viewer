import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

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
export class SourcesBarComponent {
  @Input() groups: SourceGroup[] = [];
  @Input() summary = '';
  @Input() locationCounts: LocationCount[] = [];
  @Input() open = false;
  @Output() readonly toggle = new EventEmitter<void>();
  @Output() readonly addFiles = new EventEmitter<void>();
  @Output() readonly addFolder = new EventEmitter<Event>();
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
