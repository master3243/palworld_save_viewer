import { SaveBuffer, asDict, findPropertyStart, formatGuid, readFString, readMapEntries, readPropertyList, readTagHeader } from './gvas';

export interface GuildAchievementProgress {
  research: Record<string, number> | null;
  expeditions: number | null;
}

class GuildReader {
  at = 0;
  constructor(readonly buf: SaveBuffer) {}
  skip(n: number): void {
    if (!Number.isSafeInteger(n) || n < 0 || this.at + n > this.buf.length) throw new Error('Invalid guild block');
    this.at += n;
  }
  int(): number { const n = this.buf.i32(this.at); this.skip(4); return n; }
  array(size: number): void { this.skip(this.int() * size); }
  string(): string { const [s, end] = readFString(this.buf, this.at); this.skip(end - this.at); return s; }
  guid(): string { const at = this.at; this.skip(16); return formatGuid(this.buf.bytes, at); }
}

/** Known guild layouts only; never infer membership from guild size or progress. */
export function guildMembers(raw: Uint8Array, type: string): { id: string; players: string[] } | null {
  try {
    const r = new GuildReader(new SaveBuffer(raw));
    const id = r.guid(); r.string(); r.array(32); r.skip(1);
    if (type.includes('Independent')) {
      r.skip(4); r.array(16); r.string(); const uid = r.guid(); r.string(); r.skip(8); r.string();
      return r.at === r.buf.length ? { id, players: [uid] } : null;
    }
    r.skip(4); r.array(16); r.skip(8); r.array(16); r.string(); r.skip(16); r.array(60);
    const tail = r.at;
    for (const modern of [true, false]) {
      r.at = tail;
      try {
        if (modern) { r.array(1); r.skip(4); }
        r.guid(); const count = r.int();
        if (count < 0 || count > 1000) continue;
        const players: string[] = [];
        for (let i = 0; i < count; i++) {
          players.push(r.guid()); r.skip(8); r.string(); if (modern) r.skip(1);
        }
        if (modern) {
          const n = r.int(); if (n < 0 || n > 1000) continue;
          for (let i = 0; i < n; i++) { r.skip(1); r.array(1); }
        }
        if ([4, 8].includes(r.buf.length - r.at)) return { id, players };
      } catch { /* Try the other supported tail layout. */ }
    }
  } catch { /* Unknown layouts leave the ownership-dependent checks unavailable. */ }
  return null;
}

export function expeditionCount(raw: unknown): number | null {
  if (!(raw instanceof Uint8Array) || raw.length !== 8) return null;
  const buf = new SaveBuffer(raw), count = buf.i32(0);
  return count >= 0 && buf.i32(4) === 0 ? count : null;
}

export function researchWork(raw: unknown): Record<string, number> | null {
  if (!(raw instanceof Uint8Array)) return null;
  try {
    const r = new GuildReader(new SaveBuffer(raw)), count = r.int(), work: Record<string, number> = {};
    if (count < 0 || count > 10000) return null;
    for (let i = 0; i < count; i++) {
      const id = r.string(), value = r.buf.f32(r.at); r.skip(4);
      if (!Number.isFinite(value) || value < 0) return null;
      work[id] = value;
    }
    // Known versions append the selected project ID and optionally four bytes.
    if (r.at < r.buf.length) r.string();
    return [0, 4].includes(r.buf.length - r.at) ? work : null;
  } catch { return null; }
}

export function extractGuildAchievements(buf: SaveBuffer): Record<string, GuildAchievementProgress | null> {
  const guilds = new Map<string, GuildAchievementProgress>();
  const result: Record<string, GuildAchievementProgress | null> = {};
  try {
    for (const [id, value] of readMapEntries(buf, 'GuildExtraSaveDataMap', 'guid')) {
      guilds.set(String(id), { research: researchWork(asDict(value['Lab'])['RawData']),
        expeditions: expeditionCount(asDict(value['Expedition'])['RawData']) });
    }
    for (const [id, value] of readMapEntries(buf, 'GroupSaveDataMap', 'guid')) {
      const type = String(value['GroupType']), raw = value['RawData'];
      if (!type.includes('Guild') || !(raw instanceof Uint8Array)) continue;
      const group = guildMembers(raw, type);
      if (!group || group.id !== id) continue;
      for (const uid of group.players) result[uid] = uid in result ? null : guilds.get(group.id) ?? null;
    }
  } catch { /* Retain successfully decoded, explicitly linked entries. */ }
  return result;
}

/** This is client-local history; assigning it to a player is a separate UI choice. */
export function extractMaxFriendship(buf: SaveBuffer): number | null {
  const at = findPropertyStart(buf, 'Local_MaxFriendshipPalIds');
  if (at < 0) return null;
  try {
    const tag = readTagHeader(buf, at);
    const [key, afterKey] = readFString(buf, tag.offset);
    const [value, afterValue] = readFString(buf, afterKey);
    if (tag.type !== 'MapProperty' || key !== 'StructProperty' || value !== 'IntProperty') return null;
    const end = afterValue + 1 + tag.size, count = buf.i32(afterValue + 5);
    if (count < 0 || count > 100000 || end > buf.length) return null;
    let pos = afterValue + 9, maximum = 0;
    for (let i = 0; i < count; i++) {
      const [fields, next] = readPropertyList(buf, pos, end);
      if (!fields['InstanceId'] || next <= pos || next + 4 > end) return null;
      const rank = buf.i32(next);
      if (rank < 0 || rank > 10) return null;
      maximum = Math.max(maximum, rank); pos = next + 4;
    }
    return pos === end ? maximum : null;
  } catch { return null; }
}
