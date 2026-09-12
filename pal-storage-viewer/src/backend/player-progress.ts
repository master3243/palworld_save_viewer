import { SaveBuffer, asDict, findPropertyStart, readFString, readMapEntries, readStructArrayProperty } from './gvas';

export interface PlayerAttributes {
  allocated: Record<string, number>;
  extra: Record<string, number>;
}

export function extractPlayerAttributes(buf: SaveBuffer): PlayerAttributes | null {
  const allocated = findPropertyStart(buf, 'GotStatusPointList');
  const extra = findPropertyStart(buf, 'GotExStatusPointList');
  if (allocated === -1 && extra === -1) return null;
  const points = (offset: number): Record<string, number> => Object.fromEntries(
    readStructArrayProperty(buf, offset).map(asDict)
      .filter(row => typeof row['StatusName'] === 'string' && typeof row['StatusPoint'] === 'number')
      .map(row => [String(row['StatusName']), Number(row['StatusPoint'])]));
  return { allocated: points(allocated), extra: points(extra) };
}

/** Slots start with index, quantity, and static item ID; retain only distinct positive stacks. */
export function distinctItemIds(slots: unknown): string[] | null {
  if (!Array.isArray(slots)) return null;
  const ids = new Set<string>();
  for (const slot of slots) {
    const raw = slot?.RawData;
    if (!(raw instanceof Uint8Array)) return null;
    if (!raw.length) continue;
    try {
      const buf = new SaveBuffer(raw);
      const quantity = buf.i32(4);
      const [id, end] = readFString(buf, 8);
      if (end > buf.length || quantity < 0) return null;
      if (quantity > 0 && id && id.toLowerCase() !== 'none') ids.add(id.toLowerCase());
    } catch { return null; }
  }
  return [...ids];
}

export function countDistinctItems(slots: unknown): number | null {
  return distinctItemIds(slots)?.length ?? null;
}

export function extractItemIds(buf: SaveBuffer): Record<string, string[] | null> {
  const counts: Record<string, string[] | null> = {};
  try {
    for (const [key, value] of readMapEntries(buf, 'ItemContainerSaveData')) {
      const id = asDict(key)['ID'];
      if (typeof id === 'string') counts[id] = distinctItemIds(value['Slots']);
    }
  } catch { /* Unreadable containers remain unknown without discarding the rest of the world. */ }
  return counts;
}

export function extractItemCounts(buf: SaveBuffer): Record<string, number | null> {
  return Object.fromEntries(Object.entries(extractItemIds(buf)).map(([id, items]) => [id, items?.length ?? null]));
}
