/**
 * Element and work suitability icons for a table row, shared by the table and the pal card.
 * Icon files live in assets/icons (element_NN.webp, palwork_NN.webp).
 */
import { ELEMENT_NAMES, WORK_COLUMN_KEYS, WORK_NAMES } from '../backend/lookups';
import type { PalStorageRow } from './save-parser.service';

/** Icon file number for each work suitability, in WORK_KEYS order (09 was the dropped Oil Extraction). */
const WORK_ICON_INDEX = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12];

export interface TraitIcon {
  src: string;
  name: string;
  rank: number;
  /** Ranks gained on top of the species' base (condensing, handbooks). */
  bonus?: number;
}

const pad = (index: number) => String(index).padStart(2, '0');

/** Element icons of a row, from its "elements" text (e.g. "Fire, Dark"). */
export function elementIcons(row: PalStorageRow): TraitIcon[] {
  const text = typeof row['elements'] === 'string' ? row['elements'] : '';
  return text.split(',').map((name) => name.trim()).filter(Boolean).map((name) => {
    const index = ELEMENT_NAMES.indexOf(name);
    return { src: index === -1 ? '' : `assets/icons/element_${pad(index)}.webp`, name, rank: 0 };
  });
}

/** Every work suitability, in game order, with the pal's level (0 when it lacks it) and gained ranks. */
export function workTable(row: PalStorageRow): TraitIcon[] {
  const bonusText = typeof row['work_bonus'] === 'string' ? row['work_bonus'] : '';
  const bonuses = new Map<string, number>();
  for (const part of bonusText.split(',')) {
    const match = /^(.*\S)\s+(\d+)$/.exec(part.trim());
    if (match) bonuses.set(match[1], Number(match[2]));
  }
  return WORK_COLUMN_KEYS.map((key, index) => ({
    src: `assets/icons/palwork_${pad(WORK_ICON_INDEX[index])}.webp`,
    name: WORK_NAMES[index],
    rank: Number(row[key] ?? 0),
    bonus: bonuses.get(WORK_NAMES[index]) ?? 0,
  }));
}
