import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';

import { PalStorageRow } from './save-parser.service';

interface DetailField {
  key: string;
  label: string;
  value: string;
}

@Component({
  selector: 'app-pal-detail-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './pal-detail-card.component.html',
  styleUrl: './pal-detail-card.component.css'
})
export class PalDetailCardComponent {
  @Input({ required: true }) row!: PalStorageRow;
  expandedFields = new Set<string>();

  get name(): string {
    return this.valueFor('pal_name') || this.valueFor('species_id') || 'Pal';
  }

  get subtitle(): string {
    return [this.valueFor('pal_variant'), this.valueFor('species_id')]
      .filter(Boolean)
      .join(' / ');
  }

  get fields(): DetailField[] {
    return Object.keys(this.row)
      .filter((key) => this.formatValue(this.row[key]) !== '')
      .map((key) => ({
        key,
        label: this.toLabel(key),
        value: this.formatValue(this.row[key])
      }));
  }

  isExpandable(field: DetailField): boolean {
    return field.value.length > 120 || field.value.split(';').length > 3 || field.value.split(',').length > 4;
  }

  isExpanded(field: DetailField): boolean {
    return this.expandedFields.has(field.key);
  }

  toggleField(field: DetailField): void {
    if (!this.isExpandable(field)) return;
    if (this.expandedFields.has(field.key)) {
      this.expandedFields.delete(field.key);
    } else {
      this.expandedFields.add(field.key);
    }
  }

  private valueFor(key: string): string {
    return this.formatValue(this.row[key]);
  }

  private formatValue(value: unknown): string {
    if (Array.isArray(value)) return value.join(', ');
    if (value && typeof value === 'object') return JSON.stringify(value);
    if (value === null || value === undefined) return '';
    return String(value).replace(/\s*;\s*/g, ', ');
  }

  private toLabel(key: string): string {
    return key
      .split('_')
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }
}
