import { ELEMENT_NAMES, type ActiveSkillDetail } from '../../backend/lookups';
import type { PalStorageRow } from '../save-parser.service';
import type { FilterField } from './filter-model';

export type MoveScope = 'equipped' | 'known' | 'unlearned';
export const MOVE_SCOPES: { key: MoveScope; label: string }[] = [
  { key: 'equipped', label: 'Equipped moves' },
  { key: 'known', label: 'Any known moves' },
  { key: 'unlearned', label: 'Not yet learnt moves' }
];
const list = (raw: unknown): string[] => Array.isArray(raw) ? raw.map(String) : String(raw ?? '').split(/\s*[;,]\s*/).filter(Boolean);

/** Uses the same skill IDs and details as the card. Known includes equipped; locked is separate. */
export class MoveCatalog {
  private cache = new WeakMap<PalStorageRow, Map<MoveScope, PalStorageRow[]>>();
  constructor(private detail: (id: string) => ActiveSkillDetail | null = () => null) {}

  rows(row: PalStorageRow, scope: MoveScope): PalStorageRow[] {
    let cached = this.cache.get(row);
    if (!cached) { cached = new Map(); this.cache.set(row, cached); }
    const hit = cached.get(scope);
    if (hit) return hit;
    const entries = new Map<string, { id: string; name: string; level?: number }>();
    const add = (idsKey: string, namesKey: string) => {
      const ids = list(row[idsKey]), names = list(row[namesKey]);
      for (let i = 0; i < Math.max(ids.length, names.length); i++) {
        const id = (ids[i] ?? names[i]).replace(/^EPalWazaID::/, '');
        entries.set(id, { id, name: names[i] ?? id });
      }
    };
    if (scope === 'unlearned') {
      try {
        const raw: unknown = JSON.parse(String(row['unlearned_moves'] ?? '[]'));
        if (Array.isArray(raw)) for (const move of raw) {
          if (typeof move?.id === 'string') entries.set(move.id, move);
        }
      } catch { /* Older files may not contain a learnset. */ }
    } else {
      if (scope === 'known') {
        add('mastered_skill_ids', 'learned_moves');
        add('known_skill_ids', 'known_moves');
      }
      add('active_skill_ids', 'combat_moves');
    }
    const result = [...entries.values()].map(move => {
      const detail = this.detail(move.id);
      return {
        move_name: move.name,
        move_element: detail ? ELEMENT_NAMES[detail.element] ?? '' : '',
        move_power: detail?.power ?? null,
        move_cooldown: detail?.cooldown ?? null,
        move_kind: detail ? detail.melee ? 'Melee' : 'Ranged' : '',
        move_effect: detail?.effects.map(([name]) => name).join('; ') ?? '',
        move_level: move.level ?? null,
      };
    });
    cached.set(scope, result);
    return result;
  }
}

export const MOVE_FIELDS: FilterField[] = [
  { key: 'move_name', label: 'Move name', kind: 'text', aliases: ['name'], suggest: true },
  { key: 'move_element', label: 'Element', kind: 'list', aliases: ['type', 'element'], suggest: true },
  { key: 'move_power', label: 'Power', kind: 'number', aliases: ['power'] },
  { key: 'move_cooldown', label: 'Cooldown (seconds)', kind: 'number', aliases: ['cooldown', 'ct'] },
  { key: 'move_kind', label: 'Attack kind', kind: 'text', aliases: ['kind'], suggest: true },
  { key: 'move_effect', label: 'Status effects', kind: 'list', aliases: ['effect', 'effects'], suggest: true },
  { key: 'move_level', label: 'Learnt at level', kind: 'number', aliases: ['level'], hint: 'For not yet learnt moves' },
].map(field => ({ ...field, group: 'Move details', get: (row: PalStorageRow) => row[field.key] })) as FilterField[];

export function moveFields(catalog: MoveCatalog): FilterField[] {
  return MOVE_SCOPES.flatMap(({ key, label }) => [
    { key: `${key}_type`, label: `${label}: elements`, group: 'Moves', kind: 'list' as const, aliases: [`${key}_element`], suggest: true,
      get: (row: PalStorageRow) => [...new Set(catalog.rows(row, key).map(move => String(move['move_element'])).filter(Boolean))] },
    ...(key === 'equipped' ? [] : [{ key: `${key}_count`, label: `${label}: count`, group: 'Moves', kind: 'number' as const, aliases: [],
      get: (row: PalStorageRow) => catalog.rows(row, key).length }]),
  ]);
}
