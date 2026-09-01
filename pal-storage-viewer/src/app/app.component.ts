import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';

import { PalStorageRow, SaveParserService } from './save-parser.service';

interface TableColumn {
  key: string;
  label: string;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent {
  rows: PalStorageRow[] = [];
  columns: TableColumn[] = [];
  error = '';
  isParsing = false;
  isDragging = false;

  private readonly visibleColumns = [
    'storage_slot',
    'slot_index',
    'pal_name',
    'pal_variant',
    'gender',
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
    this.columns = [];
    this.error = '';
    this.isParsing = true;
    try {
      const rows = await this.parser.parse(file);
      this.rows = rows;
      this.columns = this.buildColumns(rows);
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not load this save file.';
    } finally {
      this.isParsing = false;
    }
  }

  cellValue(row: PalStorageRow, key: string): string {
    const value = row[key];
    if (Array.isArray(value)) return value.join('; ');
    if (value && typeof value === 'object') return JSON.stringify(value);
    if (value === null || value === undefined) return '';
    return String(value);
  }

  private buildColumns(rows: PalStorageRow[]): TableColumn[] {
    const keys = new Set<string>();
    for (const row of rows) {
      Object.keys(row).forEach((key) => keys.add(key));
    }

    return this.visibleColumns
      .filter((key) => keys.has(key))
      .map((key) => ({ key, label: this.toLabel(key) }));
  }

  private toLabel(key: string): string {
    return key
      .split('_')
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }
}
