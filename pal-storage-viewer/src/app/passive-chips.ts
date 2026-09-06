/**
 * Passive skills of a table row as chips: name, colour tone (regular, gold, platinum,
 * negative) and rank arrow, from the "skills", "skill_colors" and "skill_ranks" columns.
 */
import type { PalStorageRow } from './save-parser.service';

export interface PassiveChip {
  name: string;
  tone: string;
  /** Signed rank; 0 when the skill has none. */
  rank: number;
  /** Key of the rank arrow image (passive_plus_2 …), or '' for no arrow. */
  iconKey: string;
}

/** The seven rank arrow images, keyed as in assets/ui. */
export const PASSIVE_ICON_KEYS = ['passive_plus_1', 'passive_plus_2', 'passive_plus_3', 'passive_plus_4', 'passive_minus_1', 'passive_minus_2', 'passive_minus_3'];

function listOf(row: PalStorageRow, key: string): string[] {
  const value = row[key];
  if (typeof value !== 'string' || value === '') return [];
  return value.split(', ').map((item) => item.trim());
}

export function passiveChips(row: PalStorageRow): PassiveChip[] {
  const names = listOf(row, 'skills');
  const ranks = listOf(row, 'skill_ranks');
  const tones = listOf(row, 'skill_colors');
  return names.filter(Boolean).map((name, index) => {
    const rank = Number(ranks[index] ?? 0) || 0;
    // Positive ranks go up to 4 (platinum, its own cyan chevrons); negative ones stop at 3.
    const magnitude = Math.min(rank < 0 ? 3 : 4, Math.abs(rank));
    return {
      name,
      tone: tones[index] || 'regular',
      rank,
      iconKey: magnitude ? `passive_${rank < 0 ? 'minus' : 'plus'}_${magnitude}` : '',
    };
  });
}
