import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, EventEmitter, Input, OnChanges, Output } from '@angular/core';

import type { SaveInput, SaveSetSummary } from './save-parser.service';
import type { SavePreview } from '../backend/save-preview';
import type { CompletionData } from './completion/completion-model';
import { loadCompletionData } from './completion/completion-data';
import { pendingFileDetails, type PendingFileDetail } from './pending-file-details';
import { formatSize, kindTag, kindTitle, shortFileName } from './save-file-labels';

/** A dropped file waiting for the user to confirm the load. */
export interface PendingFile {
  input: SaveInput;
  folder: string;
  name: string;
  size: number;
  kind: string;
  /** undefined = still counting, null = holds no pals. */
  pals?: number | null;
  preview?: SavePreview;
}

export interface PendingFolder {
  folder: string;
  files: PendingFile[];
}

/** Confirmation shown before a multi-file load: the files grouped by folder, with pal counts. */
@Component({
  selector: 'app-pending-files-modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './pending-files-modal.component.html',
  styleUrl: './pending-files-modal.component.css'
})
export class PendingFilesModalComponent implements OnChanges {
  @Input() folders: PendingFolder[] = [];
  @Input() loadedSets: SaveSetSummary[] = [];
  @Input() append = false;
  @Input() fileCount = 0;
  @Input() palTotal: number | null = null;
  @Input() ignored = 0;
  @Output() readonly removeFolder = new EventEmitter<PendingFolder>();
  @Output() readonly removeFile = new EventEmitter<PendingFile>();
  @Output() readonly cancel = new EventEmitter<void>();
  @Output() readonly confirm = new EventEmitter<void>();

  readonly kindTag = kindTag;
  readonly kindTitle = kindTitle;
  readonly shortFileName = shortFileName;
  readonly formatSize = formatSize;

  details = new Map<PendingFile, PendingFileDetail>();
  private completionData: CompletionData | null = null;
  private catalogPending = true;

  constructor(private readonly changeDetector: ChangeDetectorRef) {
    void loadCompletionData().then(data => {
      this.completionData = data;
    }).catch(() => {
      // File metadata and Pal counts remain usable without the tracker catalog.
    }).finally(() => {
      this.catalogPending = false;
      this.ngOnChanges();
      this.changeDetector.markForCheck();
    });
  }

  ngOnChanges(): void {
    const details = new Map<PendingFile, PendingFileDetail>();
    for (const folder of this.folders) {
      const loaded = this.append ? this.loadedSets.find(set => set.folder === folder.folder) : undefined;
      const labels = pendingFileDetails(folder.files.map(file => file.preview), this.completionData, loaded, this.catalogPending);
      folder.files.forEach((file, index) => details.set(file, labels[index]));
    }
    this.details = details;
  }

  palLabel(file: PendingFile): string {
    if (file.pals === undefined) return '…';
    if (file.pals === null) return '';
    return `${file.pals.toLocaleString()} pal${file.pals === 1 ? '' : 's'}`;
  }

  statLabel(file: PendingFile): string {
    return this.details.get(file)?.stat ?? this.palLabel(file);
  }

  trackFolder(_index: number, folder: PendingFolder): string {
    return folder.folder;
  }

  trackFile(_index: number, file: PendingFile): SaveInput {
    return file.input;
  }
}
