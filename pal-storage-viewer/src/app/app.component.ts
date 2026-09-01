import { CommonModule } from '@angular/common';
import { Component, ElementRef, ViewChild } from '@angular/core';

import { PalDetailCardComponent } from './pal-detail-card.component';
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
  imports: [CommonModule, PalDetailCardComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent {
  @ViewChild('tableScroll') tableScroll?: ElementRef<HTMLElement>;

  private originalRows: PalStorageRow[] = [];
  rows: PalStorageRow[] = [];
  columns: TableColumn[] = [];
  error = '';
  isParsing = false;
  isDragging = false;
  isColumnMenuOpen = false;
  openRowIndex: number | null = null;
  sortColumn: string | null = null;
  sortDirection: SortDirection = null;
  scrollTop = 0;
  viewportHeight = 560;

  private readonly rowHeight = 37;
  private readonly virtualBuffer = 12;

  get displayedColumns(): TableColumn[] {
    return this.columns.filter((column) => column.visible);
  }

  get detailColspan(): number {
    return this.displayedColumns.length + 1;
  }

  get virtualStartIndex(): number {
    return Math.max(0, Math.floor(this.scrollTop / this.rowHeight) - this.virtualBuffer);
  }

  get virtualEndIndex(): number {
    return Math.min(
      this.rows.length,
      Math.ceil((this.scrollTop + this.viewportHeight) / this.rowHeight) + this.virtualBuffer
    );
  }

  get virtualRows(): VirtualRow[] {
    return this.rows.slice(this.virtualStartIndex, this.virtualEndIndex).map((row, offset) => ({
      row,
      index: this.virtualStartIndex + offset
    }));
  }

  get topSpacerHeight(): number {
    return this.virtualStartIndex * this.rowHeight;
  }

  get bottomSpacerHeight(): number {
    return Math.max(0, (this.rows.length - this.virtualEndIndex) * this.rowHeight);
  }

  private readonly defaultVisibleColumns = new Set([
    'storage_slot',
    'slot_index',
    'pal_name',
    'pal_variant',
    'gender',
    'is_lucky',
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
    'learned_moves',
    'species_id'
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
    'favorite_index',
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

  constructor(private readonly parser: SaveParserService) {}

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

  private async parseFile(file: File): Promise<void> {
    this.rows = [];
    this.originalRows = [];
    this.columns = [];
    this.error = '';
    this.openRowIndex = null;
    this.sortColumn = null;
    this.sortDirection = null;
    this.scrollTop = 0;
    this.isColumnMenuOpen = false;
    this.isParsing = true;
    try {
      const rows = await this.parser.parse(file);
      this.originalRows = rows;
      this.rows = [...rows];
      this.columns = this.buildColumns(rows);
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not load this save file.';
    } finally {
      this.isParsing = false;
    }
  }

  toggleColumnMenu(): void {
    this.isColumnMenuOpen = !this.isColumnMenuOpen;
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
    this.resetTableScroll();
    this.applySort();
  }

  sortMarker(column: TableColumn): string {
    if (this.sortColumn !== column.key || !this.sortDirection) return '';
    return this.sortDirection === 'asc' ? '▲' : '▼';
  }

  toggleRow(index: number): void {
    this.openRowIndex = this.openRowIndex === index ? null : index;
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
    return this.formatSeparators(value);
  }

  cellTitle(row: PalStorageRow, column: TableColumn): string {
    const value = this.cellValue(row, column.key);
    return value ? `${column.title}: ${value}` : column.title;
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
      this.rows = [...this.originalRows];
      return;
    }

    const direction = this.sortDirection === 'asc' ? 1 : -1;
    const key = this.sortColumn;
    this.rows = [...this.originalRows].sort((left, right) => {
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
    return this.toTitle(key);
  }

  private toTitle(key: string): string {
    if (key === 'pal_variant') return 'Alpha';
    if (key === 'is_lucky') return 'Lucky';
    if (key === 'iv_hp') return 'IV HP';
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
