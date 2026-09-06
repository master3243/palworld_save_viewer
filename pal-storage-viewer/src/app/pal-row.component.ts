/**
 * One table row. OnPush: Angular skips it entirely unless one of its inputs changes, so opening a
 * card, hovering, or a resolved image promise no longer re-checks every cell of every row.
 * The cell styles live in src/app/pal-table.css (global, scoped under .pal-table).
 */
import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, EventEmitter, HostListener, Input, Output } from '@angular/core';
import { GenderIconComponent } from './gender-icon.component';
import type { PalStorageRow } from './save-parser.service';
import type { RowView, TableColumn } from './table-model';

@Component({
  selector: 'tr[app-pal-row]',
  standalone: true,
  imports: [CommonModule, GenderIconComponent],
  templateUrl: './pal-row.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'data-row', '[class.open]': 'open', '[attr.data-row-index]': 'index' },
})
export class PalRowComponent {
  @Input({ required: true }) row!: PalStorageRow;
  @Input({ required: true }) view!: RowView;
  @Input({ required: true }) columns!: TableColumn[];
  @Input() sortColumn: string | null = null;
  @Input() open = false;
  @Input() index = 0;
  @Input() palIcon = '';
  @Input() alphaIcon = '';
  @Input() uiIcons: Record<string, string> = {};
  @Input() favoriteIcons: Record<number, string> = {};
  @Input() passiveIcons: Record<string, string> = {};
  @Output() readonly toggle = new EventEmitter<MouseEvent>();

  @HostListener('click', ['$event'])
  onClick(event: MouseEvent): void {
    this.toggle.emit(event);
  }

  trackColumn(_: number, column: TableColumn): string {
    return column.key;
  }
}
