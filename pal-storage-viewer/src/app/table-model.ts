/** Types shared by the table (AppComponent) and its OnPush rows (PalRowComponent). */
import type { elementIcons, workIcons } from './trait-icons';
import type { passiveChips } from './passive-chips';

export interface TableColumn {
  key: string;
  label: string;
  title: string;
  visible: boolean;
  /** Static CSS classes of the column's cells, decided once so the template binds a string, not 15 expressions. */
  cellClass: string;
}

/** Precomputed text and IV tone of one cell. */
export interface CellView {
  text: string;
  iv: '' | 'high' | 'perfect';
}

/** Cached per-row view data for the table (see AppComponent.rowView). */
export interface RowView {
  elements: ReturnType<typeof elementIcons>;
  works: ReturnType<typeof workIcons>;
  passives: ReturnType<typeof passiveChips>;
  moves: { name: string; element: number; iconSrc: string; power: string; title: string }[];
  stars: boolean[];
  cells: Record<string, CellView | undefined>;
  alpha: boolean;
  male: boolean;
  female: boolean;
  lucky: boolean;
  favorite: number | null;
}
