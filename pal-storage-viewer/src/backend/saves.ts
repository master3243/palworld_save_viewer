/**
 * Per-file extraction: which kind of save a file is, and what it contributes.
 */
import {
  PropertyDict, SaveBuffer, ZERO_GUID, asDict, findPropertyStart, formatGuid, guidOrNull, mapEntryCount,
  readBool, readByte, readDateTime, readFString, readMapEntries, readStr, readStructProperty
} from './gvas';
import { Lookups } from './lookups';
import { PalRecord, buildRecord } from './record';
import { PlayerCompletion, extractLabResearch, extractPlayerCompletion } from './completion';

export type SaveKind = 'dimensional_storage' | 'level' | 'player' | 'level_meta' | 'world_option' | 'local_data' | 'unknown';

const SAVE_KINDS: Record<string, SaveKind> = {
  PalDimensionPalStorageSaveGame: 'dimensional_storage',
  PalWorldSaveGame: 'level',
  PalWorldPlayerSaveGame: 'player',
  PalWorldBaseInfoSaveGame: 'level_meta',
  PalWorldOptionSaveGame: 'world_option',
  PalLocalWorldSaveGame: 'local_data',
};

/** progress(done, total, found, unit) */
export type ParseProgress = (done: number, total: number, found: number, unit: string) => void;

const PROGRESS_EVERY = 50;
const MARKER = 'PalIndividualCharacterSaveParameter\0';
// An unoccupied dimensional storage slot starts with CharacterID = "None":
// name tag, NameProperty type, size 9, array index 0, no-guid flag, FString "None".
const EMPTY_SLOT_PATTERN = 'CharacterID\0\x0d\0\0\0NameProperty\0\x09\0\0\0\0\0\0\0\0\x05\0\0\0None\0';

export function detectSaveKind(buf: SaveBuffer): [SaveKind, string] {
  const pos = buf.find('/Script/Pal.', 0, Math.min(buf.length, 65536));
  if (pos === -1) return ['unknown', ''];
  const end = buf.text.indexOf('\0', pos);
  const className = buf.text.slice(pos, end === -1 ? undefined : end);
  const short = className.slice(className.lastIndexOf('.') + 1);
  return [SAVE_KINDS[short] ?? 'unknown', className];
}

/** Every Palworld save starts with a `Timestamp` DateTime; return it as ISO text (UTC, seconds). */
export function readSaveTimestamp(buf: SaveBuffer): string {
  const ticks = readDateTime(buf, findPropertyStart(buf, 'Timestamp', 0, Math.min(buf.length, 65536)));
  if (!ticks) return '';
  // Unreal ticks are 100 ns since 0001-01-01.
  const ms = ticks / 10_000 - 62_135_596_800_000;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 19);
}

export interface DimensionalStoragePayload {
  total_storage_slots: number;
  occupied_slots: number;
  records: PalRecord[];
}

export function extractDimensionalStorage(buf: SaveBuffer, lookups: Lookups, progress?: ParseProgress): DimensionalStoragePayload {
  const offsets: number[] = [];
  let pos = buf.find(MARKER);
  while (pos !== -1) {
    offsets.push(pos);
    pos = buf.find(MARKER, pos + 1);
  }
  const records: PalRecord[] = [];
  // Empty slots are large on disk but parse instantly, so progress counts occupied slots.
  const expected = Math.max(1, offsets.length - buf.count(EMPTY_SLOT_PATTERN));
  progress?.(0, expected, 0, 'pals');
  for (let slot = 0; slot < offsets.length; slot++) {
    if (progress && slot % PROGRESS_EVERY === 0 && slot) progress(Math.min(records.length, expected), expected, records.length, 'pals');
    const end = slot + 1 < offsets.length ? offsets[slot + 1] : buf.length;
    // The block opens with the struct type string, its guid and a flag; tags follow.
    const record = buildRecord(buf, offsets[slot], end, slot, lookups, null, offsets[slot] + MARKER.length + 17);
    if (record) records.push(record);
  }
  progress?.(expected, expected, records.length, 'pals');
  return { total_storage_slots: offsets.length, occupied_slots: records.length, records };
}

export interface BaseCamp {
  id: string;
  raw_name?: string;
  state?: number;
  location?: { x: number; y: number; z: number };
  area_range?: number;
  group_id?: string;
  worker_container_id: string | null;
  index: number;
}

export interface LevelPayload {
  records: PalRecord[];
  players: { player_uid: string | null; instance_id: string | null; name: string; level: number | null }[];
  bases: BaseCamp[];
  containers: Record<string, { slots: number; occupied: number }>;
  skipped: { players: number; wild_or_npc: number; unreadable: number };
  /** Guild lab research progress (research id -> work done), one entry per guild. */
  labs: Record<string, number>[];
}

function decodeBaseCamp(raw: Uint8Array): Omit<BaseCamp, 'worker_container_id' | 'index'> | null {
  try {
    const buf = new SaveBuffer(raw);
    let offset = 0;
    const id = formatGuid(raw, offset);
    offset += 16;
    const [name, afterName] = readFString(buf, offset);
    offset = afterName;
    const state = raw[offset];
    offset += 1;
    // FTransform: quaternion (4 doubles), translation (3), scale (3).
    const x = buf.f64(offset + 32);
    const y = buf.f64(offset + 40);
    const z = buf.f64(offset + 48);
    offset += 80;
    const areaRange = buf.f32(offset);
    offset += 4;
    const groupId = formatGuid(raw, offset);
    return { id, raw_name: name, state, location: { x, y, z }, area_range: areaRange, group_id: groupId };
  } catch {
    return null;
  }
}

/** PalBaseCampSaveData_WorkerDirector RawData: id, spawn transform, 2 bytes, container id. */
function decodeWorkerDirector(raw: Uint8Array): string | null {
  const offset = 16 + 80 + 2;
  return raw.length >= offset + 16 ? formatGuid(raw, offset) : null;
}

function bytesOf(value: unknown): Uint8Array {
  return value instanceof Uint8Array ? value : new Uint8Array(0);
}

export function extractLevel(buf: SaveBuffer, lookups: Lookups, progress?: ParseProgress): LevelPayload {
  const records: PalRecord[] = [];
  const players: LevelPayload['players'] = [];
  const skipped = { players: 0, wild_or_npc: 0, unreadable: 0 };
  const total = mapEntryCount(buf, 'CharacterSaveParameterMap');
  progress?.(0, total, 0, 'entries');
  let index = 0;
  for (const [key, value] of readMapEntries(buf, 'CharacterSaveParameterMap')) {
    if (progress && index % PROGRESS_EVERY === 0 && index) progress(index, total, records.length, 'entries');
    const current = index++;
    const raw = value['RawData'];
    if (!(raw instanceof Uint8Array)) {
      skipped.unreadable += 1;
      continue;
    }
    const keyDict = asDict(key);
    const identity = {
      instance_id: guidOrNull(keyDict['InstanceId']),
      instance_player_uid: guidOrNull(keyDict['PlayerUId']),
      debug_name: typeof keyDict['DebugName'] === 'string' ? keyDict['DebugName'] : '',
    };
    const block = new SaveBuffer(raw);
    if (readBool(block, findPropertyStart(block, 'IsPlayer'))) {
      players.push({
        player_uid: identity.instance_player_uid,
        instance_id: identity.instance_id,
        name: readStr(block, findPropertyStart(block, 'NickName')),
        level: readByte(block, findPropertyStart(block, 'Level')),
      });
      skipped.players += 1;
      continue;
    }
    const record = buildRecord(block, 0, block.length, current, lookups, identity);
    if (!record) {
      skipped.unreadable += 1;
      continue;
    }
    const hasContainer = record.pal_box.container_id !== null;
    const owner = record.ownership.owner_player_uid;
    const hasOwner = owner !== null && owner !== ZERO_GUID;
    if (!hasContainer && !hasOwner) {
      skipped.wild_or_npc += 1;
      continue;
    }
    records.push(record);
  }
  progress?.(total, total, records.length, 'entries');

  const bases: BaseCamp[] = [];
  for (const [baseId, value] of readMapEntries(buf, 'BaseCampSaveData', 'guid')) {
    const info = decodeBaseCamp(bytesOf(value['RawData'])) ?? { id: String(baseId) };
    const director = asDict(value['WorkerDirector']);
    bases.push({ ...info, worker_container_id: decodeWorkerDirector(bytesOf(director['RawData'])), index: bases.length + 1 });
  }

  const containers: LevelPayload['containers'] = {};
  for (const [key, value] of readMapEntries(buf, 'CharacterContainerSaveData')) {
    const slots = Array.isArray(value['Slots']) ? value['Slots'] : [];
    const occupied = slots.filter((slot) => slot && typeof slot === 'object' && !Array.isArray(slot) && bytesOf((slot as PropertyDict)['RawData']).length > 0).length;
    const id = asDict(key)['ID'];
    containers[typeof id === 'string' ? id : String(id)] = { slots: slots.length, occupied };
  }

  let labs: Record<string, number>[] = [];
  try {
    labs = extractLabResearch(buf);
  } catch {
    labs = [];
  }
  return { records, players, bases, containers, skipped, labs };
}

export interface PlayerPayload {
  player_uid: string | null;
  instance_id: string | null;
  party_container_id: string | null;
  pal_box_container_id: string | null;
  /** Bosses, effigies, journals, fast travel, Paldeck and quests; null if the file has no record. */
  completion: PlayerCompletion | null;
}

export function extractPlayer(buf: SaveBuffer): PlayerPayload {
  const guidAt = (label: string): string | null => {
    let value = readStructProperty(buf, findPropertyStart(buf, label));
    if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Uint8Array)) value = (value as PropertyDict)['ID'];
    return guidOrNull(value);
  };
  const individual = asDict(readStructProperty(buf, findPropertyStart(buf, 'IndividualId')));
  let completion: PlayerCompletion | null = null;
  try {
    completion = extractPlayerCompletion(buf);
  } catch {
    completion = null;
  }
  return {
    player_uid: guidAt('PlayerUId'),
    instance_id: guidOrNull(individual['InstanceId']),
    party_container_id: guidAt('OtomoCharacterContainerId'),
    pal_box_container_id: guidAt('PalStorageContainerId'),
    completion,
  };
}

export interface LevelMetaPayload {
  world_name: string;
  host_player_name: string;
  host_player_level: number | null;
  in_game_day: number | null;
  saved_at: string;
}

export function extractLevelMeta(buf: SaveBuffer): LevelMetaPayload {
  const info = asDict(readStructProperty(buf, findPropertyStart(buf, 'SaveData')));
  const num = (value: unknown) => (typeof value === 'number' ? value : null);
  return {
    world_name: typeof info['WorldName'] === 'string' ? info['WorldName'] : '',
    host_player_name: typeof info['HostPlayerName'] === 'string' ? info['HostPlayerName'] : '',
    host_player_level: num(info['HostPlayerLevel']),
    in_game_day: num(info['InGameDay']),
    saved_at: readSaveTimestamp(buf),
  };
}

export type ParsedFile =
  | { kind: 'dimensional_storage'; class_name: string; saved_at: string; payload: DimensionalStoragePayload }
  | { kind: 'level'; class_name: string; saved_at: string; payload: LevelPayload }
  | { kind: 'player'; class_name: string; saved_at: string; payload: PlayerPayload }
  | { kind: 'level_meta'; class_name: string; saved_at: string; payload: LevelMetaPayload }
  | { kind: 'world_option' | 'local_data' | 'unknown'; class_name: string; saved_at: string; payload: null };

/** Decode one save file (already decompressed GVAS bytes) into its parsed payload. */
export function parseSaveFile(decoded: Uint8Array, lookups: Lookups, progress?: ParseProgress): ParsedFile {
  const buf = new SaveBuffer(decoded);
  const [kind, className] = detectSaveKind(buf);
  const savedAt = readSaveTimestamp(buf);
  switch (kind) {
    case 'dimensional_storage':
      return { kind, class_name: className, saved_at: savedAt, payload: extractDimensionalStorage(buf, lookups, progress) };
    case 'level':
      return { kind, class_name: className, saved_at: savedAt, payload: extractLevel(buf, lookups, progress) };
    case 'player':
      return { kind, class_name: className, saved_at: savedAt, payload: extractPlayer(buf) };
    case 'level_meta':
      return { kind, class_name: className, saved_at: savedAt, payload: extractLevelMeta(buf) };
    default:
      return { kind, class_name: className, saved_at: savedAt, payload: null };
  }
}

/** Number of pals a parsed file contributes to the table (null when it holds none). */
export function palCount(parsed: ParsedFile): number | null {
  if (parsed.kind === 'dimensional_storage') return parsed.payload.occupied_slots;
  if (parsed.kind === 'level') return parsed.payload.records.length;
  return null;
}
