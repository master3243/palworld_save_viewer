/** Types shared by the table (AppComponent) and its OnPush rows (PalRowComponent). */
import type { elementIcons, TraitIcon } from './trait-icons';
import type { PassiveChip } from './passive-chips';
import type { TooltipData } from './game-tooltip.component';

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
  works: TraitIcon[];
  workTooltip: TooltipData | null;
  passives: (PassiveChip & { tooltip: TooltipData })[];
  moves: { name: string; element: number; iconSrc: string; power: string; tooltip: TooltipData }[];
  stars: boolean[];
  cells: Record<string, CellView | undefined>;
  alpha: boolean;
  male: boolean;
  female: boolean;
  lucky: boolean;
  favorite: number | null;
}
