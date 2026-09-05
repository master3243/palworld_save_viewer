import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

import type { SaveInput } from './save-parser.service';
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
export class PendingFilesModalComponent {
  @Input() folders: PendingFolder[] = [];
  @Input() append = false;
  @Input() fileCount = 0;
  @Input() palTotal: number | null = null;
  @Input() ignored = 0;
  @Output() readonly removeFile = new EventEmitter<PendingFile>();
  @Output() readonly cancel = new EventEmitter<void>();
  @Output() readonly confirm = new EventEmitter<void>();

  readonly kindTag = kindTag;
  readonly kindTitle = kindTitle;
  readonly shortFileName = shortFileName;
  readonly formatSize = formatSize;

  palLabel(file: PendingFile): string {
    if (file.pals === undefined) return '…';
    if (file.pals === null) return '';
    return `${file.pals.toLocaleString()} pal${file.pals === 1 ? '' : 's'}`;
  }

  trackFolder(_index: number, folder: PendingFolder): string {
    return folder.folder;
  }

  trackFile(_index: number, file: PendingFile): SaveInput {
    return file.input;
  }
}
