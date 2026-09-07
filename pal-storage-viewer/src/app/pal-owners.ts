import type { PalStorageRow } from './save-parser.service';

/** Separate single-player saves don't need another column beside File. */
export function hasMultipleOwners(rows: PalStorageRow[]): boolean {
  const ownersBySave = new Map<string, Set<string>>();
  for (const row of rows) {
    const uid = String(row['owner_player_uid'] ?? '');
    const owner = uid && !/^0+$/.test(uid.replace(/-/g, '')) ? uid : String(row['owner_name'] ?? '');
    if (!owner) continue;
    const save = String(row['save_id'] ?? '');
    const owners = ownersBySave.get(save) ?? new Set<string>();
    owners.add(owner);
    if (owners.size > 1) return true;
    ownersBySave.set(save, owners);
  }
  return false;
}

/** Ten displayed characters, including the ellipsis, without splitting Unicode code points. */
export function shortOwner(name: string): string {
  const chars = Array.from(name);
  return chars.length > 10 ? chars.slice(0, 9).join('') + '…' : name;
}
