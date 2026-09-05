import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, ElementRef, HostListener, ViewChild } from '@angular/core';

import { PalDetailCardComponent } from './pal-detail-card.component';
import { FilterBarComponent } from './filter/filter-bar.component';
import { GenderIconComponent } from './gender-icon.component';
import { APP_VERSION } from './app-version';
import { Game8LookupService } from './game8-lookup.service';
import { OfflineImageService } from './offline-image.service';
import { PalStorageRow, ParseProgress, SaveInput, SaveParserService, SaveSetSummary, SaveSource } from './save-parser.service';

interface TableColumn {
  key: string;
  label: string;
  title: string;
  visible: boolean;
}

interface VirtualRow {
  index: number;
  row: PalStorageRow;
}

type SortDirection = 'asc' | 'desc' | null;

/** Share of the progress bar covered by decoding and parsing in the worker. */
const PARSE_SHARE = 0.95;

interface LocationCount {
  location: string;
  count: number;
}

interface SourceGroup {
  set: SaveSetSummary | null;
  folder: string;
  sources: { source: SaveSource; index: number }[];
  pals: number;
}

interface PendingFile {
  input: SaveInput;
  folder: string;
  name: string;
  size: number;
  kind: string;
  /** undefined = still counting, null = holds no pals. */
  pals?: number | null;
}

interface PendingFolder {
  folder: string;
  files: PendingFile[];
}

/** Minimal typing for the non-standard directory entry API used by drag and drop. */
interface DirectoryEntryLike {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  fullPath: string;
  file(success: (file: File) => void, failure?: (error: unknown) => void): void;
  createReader(): { readEntries(success: (entries: DirectoryEntryLike[]) => void, failure?: (error: unknown) => void): void };
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, PalDetailCardComponent, FilterBarComponent, GenderIconComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent {
  @ViewChild('tableScroll') tableScroll?: ElementRef<HTMLElement>;
  @ViewChild('folderInput') folderInput?: ElementRef<HTMLInputElement>;
  @ViewChild('addFilesInput') addFilesInput?: ElementRef<HTMLInputElement>;

  originalRows: PalStorageRow[] = [];
  /** The save files currently merged into the table, aligned with `sources`. */
  private loadedInputs: SaveInput[] = [];
  sources: SaveSource[] = [];
  saveSets: SaveSetSummary[] = [];
  locationCounts: LocationCount[] = [];
  /** Live progress while parsing; the worker reports real per-record counts. */
  progress: ParseProgress | null = null;
  /** Save letters by set label. Assigned once and never reused, so B stays B after A is removed. */
  private readonly saveLetters = new Map<string, string>();
  private nextLetterIndex = 0;

  private letterFor(index: number): string {
    let ordinal = index + 1;
    let letters = '';
    while (ordinal > 0) {
      const remainder = (ordinal - 1) % 26;
      letters = String.fromCharCode(65 + remainder) + letters;
      ordinal = Math.floor((ordinal - 1) / 26);
    }
    return letters;
  }

  private assignSaveLetters(inputs: SaveInput[]): void {
    for (const input of inputs) {
      const set = this.parser.setLabel(input);
      if (!this.saveLetters.has(set)) {
        this.saveLetters.set(set, this.letterFor(this.nextLetterIndex++));
      }
    }
  }
  isSourcesOpen = false;
  /** Files waiting for the user to confirm a multi-file load. */
  pendingFiles: PendingFile[] | null = null;
  pendingAppend = false;
  pendingIgnored = 0;

  /** Grouped view of pendingFiles. Rebuilt only when the list changes, so the rows keep
   *  their DOM nodes between change-detection passes and clicks land on them. */
  pendingFolders: PendingFolder[] = [];

  private rebuildPendingFolders(): void {
    const folders = new Map<string, PendingFolder>();
    for (const file of this.pendingFiles ?? []) {
      let entry = folders.get(file.folder);
      if (!entry) {
        entry = { folder: file.folder, files: [] };
        folders.set(file.folder, entry);
      }
      entry.files.push(file);
    }
    this.pendingFolders = Array.from(folders.values());
  }

  trackPendingFolder(_index: number, folder: PendingFolder): string {
    return folder.folder;
  }

  trackPendingFile(_index: number, file: PendingFile): SaveInput {
    return file.input;
  }

  get pendingFileCount(): number {
    return this.pendingFiles?.length ?? 0;
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
      parts.push(`saved ${this.savedAtLabel(set.saved_at)}`);
    }
    const tail = group.folder.replace(/\/+$/, '').split('/').pop() ?? '';
    if (tail && !label.includes(tail)) parts.push(tail);
    return parts;
  }

  get sourceGroups(): SourceGroup[] {
    const groups = new Map<string, SourceGroup>();
    for (const [index, source] of this.sources.entries()) {
      let group = groups.get(source.set);
      if (!group) {
        group = {
          set: this.saveSets.find((set) => set.folder === source.set) ?? null,
          folder: source.set,
          sources: [],
          pals: 0
        };
        groups.set(source.set, group);
      }
      group.sources.push({ source, index });
      group.pals += source.pals;
    }
    return Array.from(groups.values());
  }

  get sourcesSummary(): string {
    const saves = this.saveSets.length;
    const files = this.sources.length;
    return `${saves} save${saves === 1 ? '' : 's'} · ${files} file${files === 1 ? '' : 's'}`;
  }

  toggleSources(): void {
    this.isSourcesOpen = !this.isSourcesOpen;
  }

  /** Long player-id file names read as "…0001_dps.sav"; the full name stays in the tooltip. */
  shortFileName(name: string): string {
    const match = /^([0-9a-f]{32})(_dps)?\.sav$/i.exec(name);
    return match ? `…${match[1].slice(-4)}${match[2] ?? ''}.sav` : name;
  }

  savedAtLabel(value: string | undefined): string {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }

  /** Two or three words on what a file contributes; shown on chips and in the confirmation. */
  kindBlurb(kind: string): string {
    switch (kind) {
      case 'level': return 'party · box · bases';
      case 'dimensional_storage': return 'dimensional storage';
      case 'player': return 'party / box ids';
      case 'level_meta': return 'world name · day';
      default: return 'no pals';
    }
  }

  onDropzoneClick(event: Event): void {
    if (this.isParsing) event.preventDefault();
  }

  sourceKindTag(source: SaveSource): string {
    return this.kindTag(source.kind);
  }

  /** Drop every file of one save at once. */
  async removeSaveGroup(group: SourceGroup): Promise<void> {
    const drop = new Set(group.sources.map((entry) => entry.index));
    const remaining = this.loadedInputs.filter((_, index) => !drop.has(index));
    if (!remaining.length) {
      await this.removeSource(-1);
      return;
    }
    await this.parseInputs(remaining, false);
  }

  get progressPercent(): number {
    return this.progress?.fraction === null || this.progress?.fraction === undefined
      ? 0
      : Math.round(Math.min(1, Math.max(0, this.progress.fraction)) * 100);
  }
  /** Rows that pass the current filter, before sorting. */
  private filteredRows: PalStorageRow[] = [];
  rows: PalStorageRow[] = [];
  columns: TableColumn[] = [];
  error = '';
  isParsing = false;
  isDragging = false;
  isColumnMenuOpen = false;
  isExportMenuOpen = false;
  isFullscreen = false;
  /** User-chosen table width in px (null = the stylesheet default). Resets on reload. */
  tableWidth: number | null = null;
  resizing = false;
  private resizeStart: { x: number; width: number; side: 'left' | 'right' } | null = null;
  private static readonly MIN_TABLE_WIDTH = 720;

  private readTableWidthLimit(): number {
    // Keep the page's horizontal padding visible on both sides.
    return Math.max(AppComponent.MIN_TABLE_WIDTH, window.innerWidth - 2 * 32);
  }

  startResize(event: PointerEvent, side: 'left' | 'right'): void {
    if (event.button !== 0) return;
    const shell = (event.currentTarget as HTMLElement).parentElement;
    if (!shell) return;
    event.preventDefault();
    this.resizeStart = { x: event.clientX, width: shell.getBoundingClientRect().width, side };
    this.resizing = true;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    // Listen only for the duration of the drag; a permanent document listener would run
    // change detection on every mouse move across the whole page.
    document.addEventListener('pointermove', this.onResizeMove);
    document.addEventListener('pointerup', this.onResizeEnd);
    document.addEventListener('pointercancel', this.onResizeEnd);
  }

  private readonly onResizeMove = (event: PointerEvent): void => {
    if (!this.resizeStart) return;
    const pulled = (event.clientX - this.resizeStart.x) * (this.resizeStart.side === 'right' ? 1 : -1);
    // The table is centred, so moving one edge out by d widens it by 2d to stay symmetric.
    const width = this.resizeStart.width + pulled * 2;
    this.tableWidth = Math.round(Math.min(this.readTableWidthLimit(), Math.max(AppComponent.MIN_TABLE_WIDTH, width)));
    this.changeDetector.markForCheck();
  };

  private readonly onResizeEnd = (): void => {
    document.removeEventListener('pointermove', this.onResizeMove);
    document.removeEventListener('pointerup', this.onResizeEnd);
    document.removeEventListener('pointercancel', this.onResizeEnd);
    if (!this.resizeStart) return;
    this.resizeStart = null;
    this.resizing = false;
    this.scheduleMeasure();
  };

  resetTableWidth(): void {
    this.tableWidth = null;
    this.scheduleMeasure();
  }
  isDropHelpOpen = false;
  openRowIndex: number | null = null;
  sortColumn: string | null = null;
  sortDirection: SortDirection = null;
  scrollTop = 0;
  viewportHeight = 560;
  /** Visible width of the table scroller; the open card is centred within it. */
  viewportWidth: number | null = null;
  palNameWidth = 140;
  detailHeight = 0;
  alphaImageSrc = '';
  readonly appVersion = APP_VERSION;
  favoriteImageSrcs: Record<number, string> = {};

  /** The demo is two snapshots of the same world, loaded as saves A and B. */
  private readonly demoFiles = [
    '2026-08-16-00-09/Level.sav',
    '2026-08-16-00-09/LevelMeta.sav',
    '2026-08-16-00-09/Players/00000000000000000000000000000001.sav',
    '2026-09-01-21-50/Level.sav',
    '2026-09-01-21-50/LevelMeta.sav',
    '2026-09-01-21-50/Players/00000000000000000000000000000001.sav',
    '2026-09-01-21-50/Players/00000000000000000000000000000001_dps.sav'
  ];

  private measureContext?: CanvasRenderingContext2D;

  // Measured from the DOM after render; 40 matches the CSS row height and is
  // only the value used before the first measurement lands.
  private rowHeight = 40;
  private readonly virtualBuffer = 12;

  get displayedColumns(): TableColumn[] {
    return this.columns.filter((column) => column.visible);
  }

  get hasData(): boolean {
    return this.originalRows.length > 0;
  }

  get isFiltered(): boolean {
    return this.filteredRows.length !== this.originalRows.length;
  }

  onFilterChanged(rows: PalStorageRow[]): void {
    this.filteredRows = rows;
    this.openRowIndex = null;
    this.detailHeight = 0;
    this.resetTableScroll();
    this.applySort();
    this.scheduleMeasure();
  }

  get detailColspan(): number {
    return this.displayedColumns.length + 1;
  }

  get virtualStartIndex(): number {
    return Math.max(0, this.indexAtOffset(this.scrollTop) - this.virtualBuffer);
  }

  get virtualEndIndex(): number {
    return Math.min(
      this.rows.length,
      this.indexAtOffset(this.scrollTop + this.viewportHeight) + 1 + this.virtualBuffer
    );
  }

  /**
   * Rows are a uniform `rowHeight` apart, except that an open detail card
   * inserts `detailHeight` after its row. Everything below is pushed down by
   * that much, so scroll offsets cannot be divided by `rowHeight` alone.
   */
  private get extraHeight(): number {
    return this.openRowIndex === null ? 0 : this.detailHeight;
  }

  private get totalContentHeight(): number {
    return this.rows.length * this.rowHeight + this.extraHeight;
  }

  /** Distance from the top of the list to the top of row `index`. */
  private rowOffset(index: number): number {
    const pushedDown = this.openRowIndex !== null && index > this.openRowIndex;
    return index * this.rowHeight + (pushedDown ? this.detailHeight : 0);
  }

  /** Inverse of rowOffset: which row is at this scroll offset. */
  private indexAtOffset(offset: number): number {
    const openIndex = this.openRowIndex;
    if (openIndex === null || this.detailHeight <= 0) {
      return Math.floor(offset / this.rowHeight);
    }

    const cardTop = (openIndex + 1) * this.rowHeight;
    if (offset < cardTop) return Math.floor(offset / this.rowHeight);
    if (offset < cardTop + this.detailHeight) return openIndex;
    return Math.floor((offset - this.detailHeight) / this.rowHeight);
  }

  get virtualRows(): VirtualRow[] {
    return this.rows.slice(this.virtualStartIndex, this.virtualEndIndex).map((row, offset) => ({
      row,
      index: this.virtualStartIndex + offset
    }));
  }

  get topSpacerHeight(): number {
    return this.rowOffset(this.virtualStartIndex);
  }

  get bottomSpacerHeight(): number {
    return Math.max(0, this.totalContentHeight - this.rowOffset(this.virtualEndIndex));
  }

  private readonly defaultVisibleColumns = new Set([
    'storage_slot',
    'save_id',
    'location',
    'pal_box_slot_index',
    'paldeck_no',
    'pal_variant',
    'gender',
    'is_lucky',
    'favorite_index',
    'pal_name',
    'nickname',
    'level',
    'rank',
    'iv_hp',
    'iv_attack',
    'iv_defense',
    'soul_rank_hp',
    'soul_rank_attack',
    'soul_rank_defense',
    'skills',
    'combat_moves',
    'learned_moves'
  ]);

  private readonly preferredColumnOrder = [
    ...this.defaultVisibleColumns,
    'location_detail',
    'save',
    'owner_name',
    'source_file',
    'source_kind',
    'unique_npc_id',
    'filtered_nickname',
    'exp',
    'rank_up_exp',
    'unused_status_points',
    'hp',
    'shield_hp',
    'soul_rank_craft_speed',
    'skill_colors',
    'skill_ranks',
    'passive_skill_ids',
    'active_skill_ids',
    'mastered_skill_ids',
    'full_stomach',
    'sanity',
    'hunger_type',
    'physical_health',
    'worker_sick',
    'is_lucky',
    'is_awakening',
    'is_player',
    'voice_id',
    'skin_name',
    'friendship_points',
    'owned_time',
    'owner_player_uid',
    'arena_rank_points',
    'pal_revive_timer',
    'current_work_suitability',
    'last_jumped_x',
    'last_jumped_y',
    'last_jumped_z'
  ];

  constructor(
    private readonly parser: SaveParserService,
    private readonly offlineImages: OfflineImageService,
    private readonly game8Lookup: Game8LookupService,
    private readonly changeDetector: ChangeDetectorRef
  ) {
    void this.offlineImages.load('assets/ui/alpha.pog').then((source) => {
      this.alphaImageSrc = source;
      this.changeDetector.markForCheck();
    });
    for (const favorite of [1, 2, 3]) {
      void this.offlineImages.load(`assets/ui/fav${favorite}.pog`).then((source) => {
        this.favoriteImageSrcs[favorite] = source;
        this.changeDetector.markForCheck();
      });
    }
    this.parser.warmUp();
  }

  async onFileInput(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    if (this.isParsing) {
      input.value = '';
      return;
    }
    const inputs = Array.from(input.files ?? []).map((file) => ({
      file,
      path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
    }));
    input.value = '';
    if (inputs.length) await this.offerInputs(inputs, this.hasData);
  }

  async onDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging = false;
    if (this.isParsing) return;
    const inputs = await this.collectDroppedFiles(event.dataTransfer);
    if (inputs.length) await this.offerInputs(inputs, this.hasData);
  }

  /**
   * Single files load straight away; anything more is confirmed with a file list
   * first. Files dropped while that list is open are added to it.
   */
  private async offerInputs(inputs: SaveInput[], append: boolean): Promise<void> {
    const candidates = inputs.filter((input) => this.parser.isCandidate(input));
    if (candidates.length <= 1 && !this.pendingFiles) {
      await this.parseInputs(inputs, append);
      return;
    }
    const pending = this.pendingFiles ? [...this.pendingFiles] : [];
    const added: PendingFile[] = [];
    for (const input of candidates) {
      const duplicate = pending.some((file) => file.input.path === input.path && file.size === input.file.size);
      if (duplicate) continue;
      const file: PendingFile = {
        input,
        folder: this.folderOf(input.path),
        name: input.file.name,
        size: input.file.size,
        kind: this.guessKind(input.file.name)
      };
      pending.push(file);
      added.push(file);
    }
    this.pendingFiles = pending;
    this.rebuildPendingFolders();
    this.pendingAppend = this.pendingFiles && this.pendingAppend ? true : append;
    this.pendingIgnored += inputs.length - candidates.length;
    // Preview counts arrive one file at a time while the user reads the list.
    void this.parser.countPals(added.map((file) => file.input), (index, kind, pals) => {
      const file = added[index];
      if (!file) return;
      file.pals = pals;
      if (kind !== 'unknown') file.kind = kind;
      this.changeDetector.markForCheck();
    });
  }

  get pendingPalTotal(): number | null {
    const files = this.pendingFiles ?? [];
    if (files.some((file) => file.pals === undefined)) return null;
    return files.reduce((sum, file) => sum + (file.pals ?? 0), 0);
  }

  pendingPalLabel(file: PendingFile): string {
    if (file.pals === undefined) return '…';
    if (file.pals === null) return '';
    return `${file.pals.toLocaleString()} pal${file.pals === 1 ? '' : 's'}`;
  }

  removePendingFile(file: PendingFile): void {
    if (!this.pendingFiles) return;
    this.pendingFiles = this.pendingFiles.filter((entry) => entry !== file);
    if (!this.pendingFiles.length) {
      this.cancelPending();
      return;
    }
    this.rebuildPendingFolders();
  }

  async confirmPending(): Promise<void> {
    const inputs = this.pendingFiles?.map((file) => file.input) ?? null;
    const append = this.pendingAppend;
    this.cancelPending();
    if (inputs?.length) await this.parseInputs(inputs, append);
  }

  cancelPending(): void {
    this.pendingFiles = null;
    this.pendingFolders = [];
    this.pendingAppend = false;
    this.pendingIgnored = 0;
  }

  private folderOf(path: string): string {
    const parts = path.split('/').filter(Boolean);
    parts.pop();
    if (parts.length && parts[parts.length - 1].toLowerCase() === 'players') parts.pop();
    return parts.join('/');
  }

  private guessKind(name: string): string {
    const lower = name.toLowerCase();
    if (lower === 'level.sav') return 'level';
    if (lower === 'levelmeta.sav') return 'level_meta';
    if (lower.endsWith('_dps.sav')) return 'dimensional_storage';
    if (/^[0-9a-f]{32}\.sav$/.test(lower)) return 'player';
    return 'unknown';
  }

  /** Short tag for a file kind, used on every chip. */
  kindTag(kind: string): string {
    switch (kind) {
      case 'dimensional_storage': return 'DPS';
      case 'level': return 'World';
      case 'player': return 'Player';
      case 'level_meta': return 'Info';
      default: return 'Skip';
    }
  }

  /** Tooltip explaining what a file kind is for. */
  kindTitle(kind: string): string {
    switch (kind) {
      case 'level': return 'Data for every Pal (minus the dimensional storage)';
      case 'dimensional_storage': return 'Dimensional Pal Storage.';
      case 'player': return 'Metadata mapping container to either the player\'s party or Pal Box (mostly can be inferred and not needed).';
      case 'level_meta': return 'Metadata used to label the save.';
      default: return 'Not a pal save; ignored.';
    }
  }

  formatSize(bytes: number): string {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${bytes} B`;
  }

  openFolderPicker(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.folderInput?.nativeElement.click();
  }

  openAddFilesPicker(): void {
    this.addFilesInput?.nativeElement.click();
  }

  async removeSource(index: number): Promise<void> {
    const remaining = index < 0 ? [] : this.loadedInputs.filter((_, position) => position !== index);
    if (!remaining.length) {
      this.resetData();
      this.loadedInputs = [];
      this.sources = [];
      this.saveSets = [];
      this.locationCounts = [];
      return;
    }
    await this.parseInputs(remaining, false);
  }

  /**
   * Walk dropped items so a whole save folder can be dropped at once. Folder
   * paths are kept so files from different worlds stay in separate sets.
   */
  private async collectDroppedFiles(transfer: DataTransfer | null): Promise<SaveInput[]> {
    if (!transfer) return [];
    const entries: DirectoryEntryLike[] = [];
    for (const item of Array.from(transfer.items ?? [])) {
      const getEntry = (item as DataTransferItem & { webkitGetAsEntry?: () => DirectoryEntryLike | null }).webkitGetAsEntry;
      const entry = getEntry ? getEntry.call(item) : null;
      if (entry) entries.push(entry);
    }
    if (!entries.length) {
      return Array.from(transfer.files ?? []).map((file) => ({ file, path: file.name }));
    }
    const inputs: SaveInput[] = [];
    for (const entry of entries) await this.walkEntry(entry, inputs);
    return inputs;
  }

  private async walkEntry(entry: DirectoryEntryLike, inputs: SaveInput[]): Promise<void> {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => entry.file(resolve, reject));
      inputs.push({ file, path: entry.fullPath.replace(/^\/+/, '') });
      return;
    }
    if (!entry.isDirectory) return;
    const reader = entry.createReader();
    for (;;) {
      const batch = await new Promise<DirectoryEntryLike[]>((resolve, reject) => reader.readEntries(resolve, reject));
      if (!batch.length) break;
      for (const child of batch) await this.walkEntry(child, inputs);
    }
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.isDragging = true;
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.isDragging = false;
  }

  startDemo(event: Event): void {
    // The dropzone is a <label> wrapping the file input, so a bare click here
    // would also pop the OS file picker. The file confirmation that follows
    // offers Cancel, so no separate prompt is needed.
    event.preventDefault();
    event.stopPropagation();
    void this.loadDemoSave();
  }

  toggleDropHelp(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDropHelpOpen = true;
  }

  closeDropHelp(): void {
    this.isDropHelpOpen = false;
  }

  toggleExportMenu(): void {
    this.isExportMenuOpen = !this.isExportMenuOpen;
    if (this.isExportMenuOpen) this.isColumnMenuOpen = false;
  }

  exportCsv(scope: 'visible' | 'all'): void {
    this.isExportMenuOpen = false;
    if (scope === 'visible' && !this.isFiltered) return;
    // "Visible" is the filtered set in its current sort order.
    const source = scope === 'visible' ? this.rows : this.originalRows;
    if (!source.length) return;

    const keys = Array.from(new Set(source.flatMap((row) => Object.keys(row))));
    const lines = [
      keys.map((key) => this.csvValue(key)).join(','),
      ...source.map((row) => keys.map((key) => this.csvValue(row[key])).join(','))
    ];
    const blob = new Blob([`\uFEFF${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = scope === 'visible' ? 'pal-storage-visible.csv' : 'pal-storage-full.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  private csvValue(value: unknown): string {
    if (value === null || value === undefined) return '';
    const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
    return `"${text.replace(/"/g, '""')}"`;
  }

  /** Menus close when the click lands anywhere outside their own control. */
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (this.isExportMenuOpen && !target?.closest('.export-wrap')) this.isExportMenuOpen = false;
    if (this.isColumnMenuOpen && !target?.closest('.gear-button, .column-menu')) this.isColumnMenuOpen = false;
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    const hadOverlay = this.pendingFiles !== null || this.isExportMenuOpen || this.isColumnMenuOpen || this.isDropHelpOpen;
    this.cancelPending();
    this.isExportMenuOpen = false;
    this.isColumnMenuOpen = false;
    if (!hadOverlay && this.isFullscreen) {
      this.toggleFullscreen();
    }
  }

  async loadDemoSave(): Promise<void> {
    this.error = '';
    this.isParsing = true;
    this.progress = { fraction: null, label: 'Downloading demo save', detail: '' };

    let inputs: SaveInput[];
    try {
      inputs = await Promise.all(this.demoFiles.map(async (path) => {
        const response = await fetch(`resources/example_save/${path}`);
        if (!response.ok) {
          throw new Error(`Could not load the demo save (${path}: ${response.status}).`);
        }
        const name = path.split('/').pop() ?? path;
        return { file: new File([await response.arrayBuffer()], name), path };
      }));
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not load the demo save.';
      return;
    } finally {
      this.isParsing = false;
      this.progress = null;
    }

    // Same confirmation as a dropped folder, so the demo shows what it is about to load.
    await this.offerInputs(inputs, this.hasData);
  }

  private resetData(): void {
    this.rows = [];
    this.originalRows = [];
    this.filteredRows = [];
    this.columns = [];
    this.error = '';
    this.openRowIndex = null;
    this.detailHeight = 0;
    this.sortColumn = null;
    this.sortDirection = null;
    this.scrollTop = 0;
    this.isColumnMenuOpen = false;
    this.isExportMenuOpen = false;
  }

  /** Merge `inputs` (optionally on top of what is already loaded) and rebuild the table. */
  private async parseInputs(inputs: SaveInput[], append: boolean): Promise<void> {
    const candidates = inputs.filter((input) => this.parser.isCandidate(input));
    if (!candidates.length) {
      this.error = 'No Palworld save files found. Drop Level.sav, a Players folder, or a _dps.sav file.';
      return;
    }
    const previous = this.loadedInputs;
    const merged = append ? [...previous] : [];
    for (const input of candidates) {
      const duplicate = merged.some((existing) =>
        existing.path === input.path && existing.file.size === input.file.size);
      if (!duplicate) merged.push(input);
    }

    this.resetData();
    this.isParsing = true;
    this.progress = { fraction: null, label: 'Initializing\u2026', detail: '' };
    this.assignSaveLetters(merged);
    try {
      // The worker owns 0..95% of the bar; the table build takes the rest.
      const result = await this.parser.parseMany(merged, (update) => {
        this.progress = {
          ...update,
          fraction: update.fraction === null ? null : update.fraction * PARSE_SHARE
        };
        this.changeDetector.markForCheck();
      }, this.saveLetters);
      const rows: PalStorageRow[] = [];
      for (const [index, row] of result.rows.entries()) {
        rows.push({ ...row, paldeck_no: await this.game8Lookup.numberFor(this.cellValue(row, 'pal_name')) });
        if (index % 500 === 0) {
          this.progress = {
            fraction: PARSE_SHARE + ((index + 1) / result.rows.length) * (1 - PARSE_SHARE),
            label: 'Building table',
            detail: `${(index + 1).toLocaleString()} of ${result.rows.length.toLocaleString()} pals`
          };
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
      }
      this.progress = { fraction: 1, label: 'Done', detail: '' };
      this.loadedInputs = merged;
      this.sources = result.sources;
      this.saveSets = result.sets;
      this.locationCounts = this.countLocations(rows);
      this.originalRows = rows;
      this.filteredRows = rows;
      this.rows = [...rows];
      this.columns = this.buildColumns(rows);
      this.palNameWidth = this.measurePalNameWidth(rows);
      this.scheduleMeasure();
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not load these save files.';
      if (append && previous.length) {
        // Keep the table that was already there.
        await this.parseInputs(previous, false);
      }
    } finally {
      this.isParsing = false;
      this.progress = null;
    }
  }

  private countLocations(rows: PalStorageRow[]): LocationCount[] {
    const counts = new Map<string, number>();
    for (const row of rows) {
      const location = this.cellValue(row, 'location') || 'Unknown';
      counts.set(location, (counts.get(location) ?? 0) + 1);
    }
    const order = ['Party', 'Pal Box', 'Dimensional Storage'];
    return Array.from(counts, ([location, count]) => ({ location, count })).sort((left, right) => {
      const leftRank = order.indexOf(left.location);
      const rightRank = order.indexOf(right.location);
      if (leftRank !== -1 || rightRank !== -1) {
        return (leftRank === -1 ? order.length : leftRank) - (rightRank === -1 ? order.length : rightRank);
      }
      return left.location.localeCompare(right.location, undefined, { numeric: true });
    });
  }

  sourceTitle(source: SaveSource): string {
    const parts = [source.kind_label];
    if (source.set) parts.push(`folder: ${source.set}`);
    if (source.world_name) parts.push(`world: ${source.world_name}`);
    if (source.players) parts.push(`${source.players} player${source.players === 1 ? '' : 's'}`);
    if (source.bases) parts.push(`${source.bases} base${source.bases === 1 ? '' : 's'}`);
    if (source.skipped?.wild_or_npc) parts.push(`${source.skipped.wild_or_npc} wild/NPC skipped`);
    if (source.note) parts.push(source.note);
    return parts.join(' · ');
  }

  trackSource(index: number): number {
    return index;
  }

  toggleFullscreen(): void {
    this.isFullscreen = !this.isFullscreen;
    this.isColumnMenuOpen = false;
    this.isExportMenuOpen = false;
    // The table's virtual scroller sizes itself from the viewport; remeasure after the layout change.
    this.scheduleMeasure();
  }

  toggleColumnMenu(): void {
    this.isColumnMenuOpen = !this.isColumnMenuOpen;
    if (this.isColumnMenuOpen) this.isExportMenuOpen = false;
  }

  toggleColumn(column: TableColumn): void {
    column.visible = !column.visible;
  }

  toggleSort(column: TableColumn): void {
    if (this.sortColumn !== column.key) {
      this.sortColumn = column.key;
      this.sortDirection = 'asc';
    } else if (this.sortDirection === 'asc') {
      this.sortDirection = 'desc';
    } else {
      this.sortColumn = null;
      this.sortDirection = null;
    }
    this.openRowIndex = null;
    this.detailHeight = 0;
    this.resetTableScroll();
    this.applySort();
  }

  sortMarker(column: TableColumn): string {
    if (this.sortColumn !== column.key || !this.sortDirection) return '';
    return this.sortDirection === 'asc' ? '▲' : '▼';
  }

  toggleRow(index: number, event: MouseEvent): void {
    const scroller = this.tableScroll?.nativeElement;
    const clickedTarget = event.currentTarget as HTMLElement | null;
    const clickedRow = clickedTarget?.closest<HTMLElement>('.data-row') ?? null;
    const anchorTop = scroller && clickedRow
      ? clickedRow.getBoundingClientRect().top - scroller.getBoundingClientRect().top
      : null;
    const nextOpenIndex = this.openRowIndex === index ? null : index;

    // scrollTop is expressed in coordinates that include the old detail card.
    // Remove the part of that card which is above the viewport before moving
    // the detail height to a different row, otherwise every later row jumps.
    if (scroller && this.openRowIndex !== null && this.openRowIndex !== nextOpenIndex && this.detailHeight > 0) {
      const oldCardTop = (this.openRowIndex + 1) * this.rowHeight;
      const oldHeightAboveViewport = Math.max(
        0,
        Math.min(this.detailHeight, scroller.scrollTop - oldCardTop)
      );
      if (oldHeightAboveViewport > 0) {
        scroller.scrollTop -= oldHeightAboveViewport;
        this.scrollTop = scroller.scrollTop;
      }
    }

    this.openRowIndex = nextOpenIndex;
    this.detailHeight = 0;
    this.scheduleMeasure(nextOpenIndex, anchorTop);
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    // The detail card is a responsive grid, so its height changes with width.
    this.scheduleMeasure();
  }

  /**
   * The virtual scroll model has to match real layout exactly: any per-row
   * error compounds with scroll depth. Measure rather than assume.
   */
  private scheduleMeasure(anchorIndex: number | null = null, anchorTop: number | null = null): void {
    requestAnimationFrame(() => {
      const scroller = this.tableScroll?.nativeElement;
      if (!scroller) return;

      const row = scroller.querySelector<HTMLElement>('.data-row');
      if (row?.offsetHeight) this.rowHeight = row.offsetHeight;

      if (scroller.clientHeight) this.viewportHeight = scroller.clientHeight;
      if (scroller.clientWidth) this.viewportWidth = scroller.clientWidth;

      const card = scroller.querySelector<HTMLElement>('.detail-row');
      this.detailHeight = this.openRowIndex === null ? 0 : card?.offsetHeight ?? 0;

      if (anchorIndex !== null && anchorTop !== null) {
        requestAnimationFrame(() => {
          const anchoredRow = scroller.querySelector<HTMLElement>(`[data-row-index="${anchorIndex}"]`);
          if (!anchoredRow) return;
          const currentTop = anchoredRow.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
          const correction = currentTop - anchorTop;
          if (Math.abs(correction) > 0.5) {
            scroller.scrollTop += correction;
            this.scrollTop = scroller.scrollTop;
          }
        });
      }
    });
  }

  isRowOpen(index: number): boolean {
    return this.openRowIndex === index;
  }

  onTableScroll(event: Event): void {
    const target = event.target as HTMLElement;
    this.scrollTop = target.scrollTop;
    this.viewportHeight = target.clientHeight;
  }

  trackColumn(_: number, column: TableColumn): string {
    return column.key;
  }

  trackVirtualRow(_: number, item: VirtualRow): number {
    return item.index;
  }

  cellValue(row: PalStorageRow, key: string): string {
    const value = row[key];
    if (Array.isArray(value)) return value.join('; ');
    if (value && typeof value === 'object') return JSON.stringify(value);
    if (value === null || value === undefined) return '';
    return String(value);
  }

  cellDisplay(row: PalStorageRow, column: TableColumn): string {
    const value = this.cellValue(row, column.key);
    if (column.key === 'pal_variant') return this.isAlpha(row) ? 'A' : '';
    if (column.key === 'gender') return this.genderIcon(value);
    if (column.key === 'is_lucky') return this.isLucky(row) ? '★' : '';
    if (column.key === 'rank') return this.displayRank(value);
    return this.formatSeparators(value);
  }

  cellTitle(row: PalStorageRow, column: TableColumn): string {
    const value = this.cellValue(row, column.key);
    if (column.key === 'rank' && value) return `${column.title}: ${this.displayRank(value)} of 4`;
    return value ? `${column.title}: ${value}` : column.title;
  }

  private displayRank(value: string): string {
    const storedRank = Number(value);
    return Number.isFinite(storedRank) ? String(Math.max(0, Math.min(4, storedRank - 1))) : value;
  }

  isSlotNumber(column: TableColumn): boolean {
    return column.key === 'storage_slot' || column.key === 'pal_box_slot_index';
  }

  isWhere(column: TableColumn): boolean {
    return column.key === 'location';
  }

  isSaveLetter(column: TableColumn): boolean {
    return column.key === 'save_id';
  }

  isSoulRank(column: TableColumn): boolean {
    return column.key.startsWith('soul_rank_');
  }

  isIv(column: TableColumn): boolean {
    return column.key.startsWith('iv_');
  }

  isHighIv(row: PalStorageRow, column: TableColumn): boolean {
    if (!this.isIv(column)) return false;
    const value = Number(this.cellValue(row, column.key));
    return value >= 70 && value < 100;
  }

  isPerfectIv(row: PalStorageRow, column: TableColumn): boolean {
    return this.isIv(column) && Number(this.cellValue(row, column.key)) === 100;
  }

  isAlpha(row: PalStorageRow): boolean {
    return this.cellValue(row, 'pal_variant').toLowerCase() === 'alpha';
  }

  isMale(row: PalStorageRow): boolean {
    return this.cellValue(row, 'gender').toLowerCase() === 'male';
  }

  isFemale(row: PalStorageRow): boolean {
    return this.cellValue(row, 'gender').toLowerCase() === 'female';
  }

  isLucky(row: PalStorageRow): boolean {
    return this.cellValue(row, 'is_lucky').toLowerCase() === 'true';
  }

  favoriteIndex(row: PalStorageRow): number {
    const favorite = Number(this.cellValue(row, 'favorite_index'));
    return favorite >= 1 && favorite <= 3 ? favorite : 0;
  }

  rankStarsFor(row: PalStorageRow): boolean[] {
    const rank = Number(this.displayRank(this.cellValue(row, 'rank'))) || 0;
    return Array.from({ length: 4 }, (_, index) => index < rank);
  }

  /**
   * The table is `table-layout: fixed`, so column widths never follow content.
   * Measure the longest name up front and set the width explicitly instead.
   */
  private measurePalNameWidth(rows: PalStorageRow[]): number {
    const minWidth = 116;
    const maxWidth = 320;
    const cellPadding = 26;

    // Header is bold and carries the sort arrow, so it can be the widest thing.
    let widest = this.measureText('Pal Name', 750) + 18;
    for (const row of rows) {
      widest = Math.max(widest, this.measureText(this.cellValue(row, 'pal_name'), 400));
    }

    return Math.round(Math.min(maxWidth, Math.max(minWidth, widest + cellPadding)));
  }

  private measureText(text: string, weight: number): number {
    this.measureContext ??= document.createElement('canvas').getContext('2d') ?? undefined;
    if (!this.measureContext) return text.length * 7.4;

    const rootSize = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    this.measureContext.font =
      `${weight} ${0.84 * rootSize}px Inter, ui-sans-serif, system-ui, -apple-system, ` +
      `BlinkMacSystemFont, "Segoe UI", sans-serif`;
    return this.measureContext.measureText(text).width;
  }

  private buildColumns(rows: PalStorageRow[]): TableColumn[] {
    const keys = new Set<string>();
    for (const row of rows) {
      Object.keys(row).forEach((key) => keys.add(key));
    }

    const orderedKeys = [
      ...this.preferredColumnOrder.filter((key) => keys.delete(key)),
      ...Array.from(keys).sort((left, right) => left.localeCompare(right))
    ];

    const multiplePlayers = this.saveSets.some((set) => set.players.length > 1);
    return orderedKeys.map((key) => ({
      key,
      label: this.toLabel(key),
      title: this.toTitle(key),
      visible: this.defaultVisibleColumns.has(key)
        || (key === 'owner_name' && multiplePlayers)
    }));
  }

  private applySort(): void {
    if (!this.sortColumn || !this.sortDirection) {
      this.rows = [...this.filteredRows];
      return;
    }

    const direction = this.sortDirection === 'asc' ? 1 : -1;
    const key = this.sortColumn;
    this.rows = [...this.filteredRows].sort((left, right) => {
      const leftValue = this.sortValue(left[key]);
      const rightValue = this.sortValue(right[key]);
      if (typeof leftValue === 'number' && typeof rightValue === 'number') {
        return (leftValue - rightValue) * direction;
      }
      return String(leftValue).localeCompare(String(rightValue), undefined, {
        numeric: true,
        sensitivity: 'base'
      }) * direction;
    });
  }

  private resetTableScroll(): void {
    this.scrollTop = 0;
    if (this.tableScroll) {
      this.tableScroll.nativeElement.scrollTop = 0;
    }
  }

  private sortValue(value: unknown): string | number {
    if (typeof value === 'number') return value;
    const text = this.cellValue({ value }, 'value');
    const numberValue = Number(text);
    return text.trim() !== '' && Number.isFinite(numberValue) ? numberValue : text;
  }

  private toLabel(key: string): string {
    if (key === 'pal_variant') return 'A';
    if (key === 'gender') return 'G';
    if (key === 'is_lucky') return 'L';
    if (key === 'storage_slot') return 'Slot';
    if (key === 'pal_box_slot_index') return 'Box';
    if (key === 'location') return 'Where';
    if (key === 'save_id') return 'Save';
    if (key === 'save') return 'Save name';
    if (key === 'location_detail') return 'Detail';
    if (key === 'source_file') return 'File';
    if (key === 'owner_name') return 'Owner';
    if (key === 'paldeck_no') return 'No';
    if (key === 'favorite_index') return 'F';
    if (key === 'level') return 'LVL';
    if (key === 'soul_rank_hp') return 'SR HP';
    if (key === 'soul_rank_attack') return 'SR ATK';
    if (key === 'soul_rank_defense') return 'SR DEF';
    return this.toTitle(key);
  }

  private toTitle(key: string): string {
    if (key === 'paldeck_no') return 'Paldeck No.';
    if (key === 'pal_box_slot_index') return 'Pal Box slot';
    if (key === 'location') return 'Location';
    if (key === 'location_detail') return 'Location detail';
    if (key === 'save_id') return 'Save (letter)';
    if (key === 'save') return 'Save name';
    if (key === 'source_file') return 'Source file';
    if (key === 'owner_name') return 'Owner';
    if (key === 'pal_variant') return 'Alpha';
    if (key === 'is_lucky') return 'Lucky';
    if (key === 'iv_hp') return 'IV HP';
    if (key === 'soul_rank_hp') return 'Soul Rank HP';
    if (key === 'iv_attack') return 'IV ATK';
    if (key === 'iv_defense') return 'IV DEF';
    return key
      .split('_')
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  private genderIcon(value: string): string {
    const normalized = value.toLowerCase();
    if (normalized === 'female') return '♀';
    if (normalized === 'male') return '♂';
    return value;
  }

  private formatSeparators(value: string): string {
    return value.replace(/\s*;\s*/g, ', ');
  }
}
