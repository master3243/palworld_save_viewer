import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, ElementRef, HostListener, ViewChild } from '@angular/core';

import { PalDetailCardComponent } from './pal-detail-card.component';
import { FilterBarComponent } from './filter/filter-bar.component';
import { GenderIconComponent } from './gender-icon.component';
import { APP_VERSION } from './app-version';
import { Game8LookupService } from './game8-lookup.service';
import { OfflineImageService } from './offline-image.service';
import { PalStorageRow, SaveParserService } from './save-parser.service';

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

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, PalDetailCardComponent, FilterBarComponent, GenderIconComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent {
  @ViewChild('tableScroll') tableScroll?: ElementRef<HTMLElement>;

  originalRows: PalStorageRow[] = [];
  /** Rows that pass the current filter, before sorting. */
  private filteredRows: PalStorageRow[] = [];
  rows: PalStorageRow[] = [];
  columns: TableColumn[] = [];
  error = '';
  isParsing = false;
  isDragging = false;
  isColumnMenuOpen = false;
  isExportMenuOpen = false;
  isDemoPromptOpen = false;
  isDropHelpOpen = false;
  openRowIndex: number | null = null;
  sortColumn: string | null = null;
  sortDirection: SortDirection = null;
  scrollTop = 0;
  viewportHeight = 560;
  palNameWidth = 140;
  detailHeight = 0;
  alphaImageSrc = '';
  readonly appVersion = APP_VERSION;
  favoriteImageSrcs: Record<number, string> = {};

  private readonly demoSaveName = '00000000000000000000000000000001_dps.sav';
  private readonly demoSaveUrl = `resources/example_save/${this.demoSaveName}`;

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
    'slot_index',
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
  }

  async onFileInput(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) await this.parseFile(file);
    input.value = '';
  }

  async onDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    this.isDragging = false;
    const file = event.dataTransfer?.files?.[0];
    if (file) await this.parseFile(file);
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.isDragging = true;
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.isDragging = false;
  }

  openDemoPrompt(event: Event): void {
    // The dropzone is a <label> wrapping the file input, so a bare click here
    // would also pop the OS file picker.
    event.preventDefault();
    event.stopPropagation();
    this.isDemoPromptOpen = true;
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

  closeDemoPrompt(): void {
    this.isDemoPromptOpen = false;
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.closeDemoPrompt();
    this.isExportMenuOpen = false;
  }

  async loadDemoSave(): Promise<void> {
    this.isDemoPromptOpen = false;
    this.error = '';
    this.isParsing = true;

    let file: File;
    try {
      const response = await fetch(this.demoSaveUrl);
      if (!response.ok) {
        throw new Error(`Could not load the demo save (${response.status}).`);
      }
      file = new File([await response.arrayBuffer()], this.demoSaveName);
    } catch (error) {
      this.isParsing = false;
      this.error = error instanceof Error ? error.message : 'Could not load the demo save.';
      return;
    }

    await this.parseFile(file);
  }

  private async parseFile(file: File): Promise<void> {
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
    this.isParsing = true;
    try {
      const parsedRows = await this.parser.parse(file);
      const rows = await Promise.all(parsedRows.map(async (row) => ({
        ...row,
        paldeck_no: await this.game8Lookup.numberFor(this.cellValue(row, 'pal_name'))
      })));
      this.originalRows = rows;
      this.filteredRows = rows;
      this.rows = [...rows];
      this.columns = this.buildColumns(rows);
      this.palNameWidth = this.measurePalNameWidth(rows);
      this.scheduleMeasure();
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not load this save file.';
    } finally {
      this.isParsing = false;
    }
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
    return column.key === 'storage_slot' || column.key === 'slot_index';
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

    return orderedKeys.map((key) => ({
      key,
      label: this.toLabel(key),
      title: this.toTitle(key),
      visible: this.defaultVisibleColumns.has(key)
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
    if (key === 'slot_index') return 'Ind';
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
