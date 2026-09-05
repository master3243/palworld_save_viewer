/**
 * Low-level readers for Unreal GVAS tagged properties.
 *
 * Everything works on a SaveBuffer: the decoded save bytes plus a one-byte-per-char
 * text copy so property labels can be located with the engine's native string
 * search. All offsets are absolute positions in the buffer; readers return null for
 * anything missing or malformed.
 */

export const ZERO_GUID = '00000000-0000-0000-0000-000000000000';

const latin1 = new TextDecoder('latin1');
const utf8 = new TextDecoder('utf-8');
const utf16 = new TextDecoder('utf-16le');

export type PropertyValue =
  | null | boolean | number | string | Uint8Array | PropertyValue[] | { [key: string]: PropertyValue };

export type PropertyDict = { [key: string]: PropertyValue };

export class SaveBuffer {
  readonly bytes: Uint8Array;
  readonly view: DataView;
  /** One char per byte; labels are ASCII so indexOf on this is an exact byte search. */
  readonly text: string;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.text = latin1.decode(bytes);
  }

  get length(): number {
    return this.bytes.length;
  }

  /** Byte offset of `needle` (ASCII) at or after `start`, fully before `end`, else -1. */
  find(needle: string, start = 0, end = this.bytes.length): number {
    const pos = this.text.indexOf(needle, start);
    return pos === -1 || pos + needle.length > end ? -1 : pos;
  }

  /** Count non-overlapping occurrences of an ASCII pattern. */
  count(needle: string): number {
    let total = 0;
    let pos = this.text.indexOf(needle);
    while (pos !== -1) {
      total += 1;
      pos = this.text.indexOf(needle, pos + needle.length);
    }
    return total;
  }

  i32(offset: number): number { return this.view.getInt32(offset, true); }
  u16(offset: number): number { return this.view.getUint16(offset, true); }
  i64(offset: number): number { return Number(this.view.getBigInt64(offset, true)); }
  f32(offset: number): number { return this.view.getFloat32(offset, true); }
  f64(offset: number): number { return this.view.getFloat64(offset, true); }
}

export function formatGuid(bytes: Uint8Array, offset = 0): string {
  // Unreal FGuid is four little-endian 32-bit words, printed big-endian, 8-4-4-4-12.
  let hex = '';
  for (let word = 0; word < 4; word++) {
    for (let i = 3; i >= 0; i--) {
      hex += bytes[offset + word * 4 + i].toString(16).padStart(2, '0');
    }
  }
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function guidOrNull(value: PropertyValue | undefined): string | null {
  return typeof value === 'string' && value !== ZERO_GUID ? value : null;
}

export function enumShort(value: PropertyValue | undefined): PropertyValue | undefined {
  if (typeof value === 'string') {
    const index = value.indexOf('::');
    return index === -1 ? value : value.slice(index + 2);
  }
  return value;
}

/**
 * Thrown internally when bytes do not parse; callers turn it into null/[]. A single
 * shared instance: capturing a stack trace per failed probe dominated the profile.
 */
class ReadError extends Error {}
const READ_ERROR = new ReadError('unreadable');

function fail(): never {
  throw READ_ERROR;
}

/**
 * Read an FString at offset; returns [value, nextOffset]. `limit` is the end of the
 * enclosing block: a string that runs past it is truncated there rather than failing.
 */
export function readFString(buf: SaveBuffer, offset: number, limit = buf.length): [string, number] {
  if (offset < 0 || offset + 4 > limit) fail();
  const length = buf.i32(offset);
  offset += 4;
  if (length === 0) return ['', offset];
  if (length < 0) {
    const chars = -length;
    const end = offset + chars * 2;
    if (chars > 1_000_000 || end > limit) fail();
    return [utf16.decode(buf.bytes.subarray(offset, end - 2)), end];
  }
  let end = offset + length;
  if (length > 1_000_000) fail();
  if (end > limit) end = limit;
  // ASCII fast path straight from the text copy; anything else goes through UTF-8.
  let ascii = true;
  for (let i = offset; i < end - 1; i++) {
    if (buf.bytes[i] >= 0x80) { ascii = false; break; }
  }
  const value = ascii ? buf.text.slice(offset, end - 1) : utf8.decode(buf.bytes.subarray(offset, end - 1));
  return [value, offset + length];
}

export interface TagHeader {
  name: string;
  type: string | null;
  size: number;
  /** Offset just after the header (after size + array index). */
  offset: number;
}

export function readTagHeader(buf: SaveBuffer, offset: number, limit = buf.length): TagHeader {
  const [name, afterName] = readFString(buf, offset, limit);
  if (name === 'None') return { name, type: null, size: 0, offset: afterName };
  const [type, afterType] = readFString(buf, afterName, limit);
  if (afterType + 8 > limit) fail();
  const size = buf.i64(afterType);
  return { name, type, size, offset: afterType + 8 };
}

/** Offset just after a tagged property, without decoding it. */
function skipProperty(buf: SaveBuffer, offset: number): [string, number] {
  const tag = readTagHeader(buf, offset);
  if (tag.name === 'None') return [tag.name, tag.offset];
  let at = tag.offset;
  switch (tag.type) {
    case 'BoolProperty':
      return [tag.name, at + 2];
    case 'ByteProperty':
    case 'EnumProperty':
    case 'ArrayProperty':
    case 'SetProperty':
      at = readFString(buf, at)[1] + 1;
      return [tag.name, at + tag.size];
    case 'StructProperty':
      at = readFString(buf, at)[1] + 17;
      return [tag.name, at + tag.size];
    case 'MapProperty':
      at = readFString(buf, readFString(buf, at)[1])[1] + 1;
      return [tag.name, at + tag.size];
    default:
      return [tag.name, at + 1 + tag.size];
  }
}

/**
 * Offsets of the top-level tagged properties in [start, end), by name (first wins).
 * Walking the tags once makes every later field lookup O(1) instead of a byte search
 * from the block start.
 */
export function indexProperties(buf: SaveBuffer, start: number, end: number): Map<string, number> {
  const index = new Map<string, number>();
  let offset = start;
  try {
    while (offset < end) {
      const [name, next] = skipProperty(buf, offset);
      if (name !== 'None' && !index.has(name)) index.set(name, offset);
      if (next <= offset) break;
      offset = next;
    }
  } catch (error) {
    if (!(error === READ_ERROR || error instanceof RangeError)) throw error;
  }
  return index;
}

/**
 * Offset of the tag header for property `label` within [start, end), or -1. Matches
 * `label\0` preceded by its own FString length so substrings of other names are skipped.
 */
export function findPropertyStart(buf: SaveBuffer, label: string, start = 0, end = buf.length): number {
  const needle = label + '\0';
  const expected = label.length + 1;
  let pos = buf.find(needle, start, end);
  while (pos !== -1) {
    if (pos >= 4 && buf.i32(pos - 4) === expected) return pos - 4;
    pos = buf.find(needle, pos + 1, end);
  }
  return -1;
}

function guarded<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch (error) {
    if (error === READ_ERROR || error instanceof RangeError) return fallback;
    throw error;
  }
}

function scalar(buf: SaveBuffer, offset: number, expectedType: string, read: (at: number) => number): number | null {
  if (offset === -1) return null;
  return guarded(() => {
    const tag = readTagHeader(buf, offset);
    if (tag.type !== expectedType) return null;
    return read(tag.offset + 1);
  }, null);
}

export function readBool(buf: SaveBuffer, offset: number): boolean | null {
  if (offset === -1) return null;
  return guarded(() => {
    const tag = readTagHeader(buf, offset);
    if (tag.type !== 'BoolProperty') return null;
    return buf.bytes[tag.offset] !== 0;
  }, null);
}

export function readByte(buf: SaveBuffer, offset: number): number | null {
  if (offset === -1) return null;
  return guarded(() => {
    const tag = readTagHeader(buf, offset);
    if (tag.type !== 'ByteProperty') return null;
    const [, afterEnum] = readFString(buf, tag.offset);
    return buf.bytes[afterEnum + 1];
  }, null);
}

export const readInt = (buf: SaveBuffer, offset: number) => scalar(buf, offset, 'IntProperty', (at) => buf.i32(at));
export const readUInt16 = (buf: SaveBuffer, offset: number) => scalar(buf, offset, 'UInt16Property', (at) => buf.u16(at));
export const readInt64 = (buf: SaveBuffer, offset: number) => scalar(buf, offset, 'Int64Property', (at) => buf.i64(at));
export const readFloat = (buf: SaveBuffer, offset: number) => scalar(buf, offset, 'FloatProperty', (at) => buf.f32(at));

export function readName(buf: SaveBuffer, offset: number): string | null {
  if (offset === -1) return null;
  return guarded(() => {
    const tag = readTagHeader(buf, offset);
    if (tag.type !== 'NameProperty') return null;
    return readFString(buf, tag.offset + 1)[0];
  }, null);
}

export function readStr(buf: SaveBuffer, offset: number): string {
  if (offset === -1) return '';
  return guarded(() => {
    const tag = readTagHeader(buf, offset);
    if (tag.type !== 'StrProperty') return '';
    return readFString(buf, tag.offset + 1)[0];
  }, '');
}

export function readEnum(buf: SaveBuffer, offset: number, prefix = ''): string {
  if (offset === -1) return '';
  return guarded(() => {
    const tag = readTagHeader(buf, offset);
    if (tag.type !== 'EnumProperty') return '';
    const [, afterEnum] = readFString(buf, tag.offset);
    const [value] = readFString(buf, afterEnum + 1);
    return value.startsWith(prefix) ? value.slice(prefix.length) : value;
  }, '');
}

function readStringArray(buf: SaveBuffer, offset: number, innerType: string, prefix: string): string[] {
  if (offset === -1) return [];
  return guarded(() => {
    const tag = readTagHeader(buf, offset);
    if (tag.type !== 'ArrayProperty') return [];
    const [inner, afterInner] = readFString(buf, tag.offset);
    let at = afterInner + 1;
    const count = buf.i32(at);
    at += 4;
    if (count < 0 || count > 128 || inner !== innerType) return [];
    const values: string[] = [];
    for (let i = 0; i < count; i++) {
      const [value, next] = readFString(buf, at);
      values.push(value.startsWith(prefix) ? value.slice(prefix.length) : value);
      at = next;
    }
    return values;
  }, []);
}

export const readEnumArray = (buf: SaveBuffer, offset: number, prefix = '') => readStringArray(buf, offset, 'EnumProperty', prefix);
export const readNameArray = (buf: SaveBuffer, offset: number) => readStringArray(buf, offset, 'NameProperty', '');

interface StructPayload {
  start: number;
  end: number;
  structType: string;
}

export function readStructPayload(buf: SaveBuffer, offset: number, expectedType?: string): StructPayload | null {
  if (offset === -1) return null;
  return guarded(() => {
    const tag = readTagHeader(buf, offset);
    if (tag.type !== 'StructProperty') return null;
    const [structType, afterType] = readFString(buf, tag.offset);
    if (expectedType && structType !== expectedType) return null;
    const start = afterType + 17;
    if (start + tag.size > buf.length) return null;
    return { start, end: start + tag.size, structType };
  }, null);
}

export function readFixedPoint64(buf: SaveBuffer, offset: number): number | null {
  const payload = readStructPayload(buf, offset, 'FixedPoint64');
  if (!payload) return null;
  const value = readInt64(buf, findPropertyStart(buf, 'Value', payload.start, payload.end));
  return value === null ? null : value / 1000;
}

export function readGuid(buf: SaveBuffer, offset: number): string | null {
  const payload = readStructPayload(buf, offset, 'Guid');
  if (!payload || payload.end - payload.start < 16) return null;
  return formatGuid(buf.bytes, payload.start);
}

export function readDateTime(buf: SaveBuffer, offset: number): number | null {
  const payload = readStructPayload(buf, offset, 'DateTime');
  if (!payload || payload.end - payload.start < 8) return null;
  return buf.i64(payload.start);
}

export function readVector(buf: SaveBuffer, offset: number): { x: number; y: number; z: number } | null {
  const payload = readStructPayload(buf, offset, 'Vector');
  if (!payload) return null;
  const size = payload.end - payload.start;
  if (size >= 24) return { x: buf.f64(payload.start), y: buf.f64(payload.start + 8), z: buf.f64(payload.start + 16) };
  if (size >= 12) return { x: buf.f32(payload.start), y: buf.f32(payload.start + 4), z: buf.f32(payload.start + 8) };
  return null;
}

/* ------------------------------------------------------------------ generic */

const SCALAR_READERS: Record<string, (buf: SaveBuffer, at: number) => number> = {
  IntProperty: (b, at) => b.i32(at),
  Int64Property: (b, at) => b.i64(at),
  Int16Property: (b, at) => b.view.getInt16(at, true),
  Int8Property: (b, at) => b.view.getInt8(at),
  UInt16Property: (b, at) => b.u16(at),
  UInt32Property: (b, at) => b.view.getUint32(at, true),
  UInt64Property: (b, at) => Number(b.view.getBigUint64(at, true)),
  FloatProperty: (b, at) => b.f32(at),
  DoubleProperty: (b, at) => b.f64(at),
};

const SCALAR_SIZES: Record<string, number> = {
  IntProperty: 4, Int64Property: 8, Int16Property: 2, Int8Property: 1,
  UInt16Property: 2, UInt32Property: 4, UInt64Property: 8, FloatProperty: 4, DoubleProperty: 8,
};

/** Read one tagged property. Returns [name, value, nextOffset]; name is null at the terminator. */
export function readPropertyValue(buf: SaveBuffer, offset: number): [string | null, PropertyValue, number] {
  const tag = readTagHeader(buf, offset);
  if (tag.name === 'None') return [null, null, tag.offset];
  let at = tag.offset;
  switch (tag.type) {
    case 'BoolProperty':
      return [tag.name, buf.bytes[at] !== 0, at + 2];
    case 'ByteProperty': {
      const [enumName, afterEnum] = readFString(buf, at);
      at = afterEnum + 1;
      const value: PropertyValue = enumName === 'None' || tag.size === 1 ? buf.bytes[at] : readFString(buf, at)[0];
      return [tag.name, value, at + tag.size];
    }
    case 'EnumProperty': {
      const [, afterEnum] = readFString(buf, at);
      at = afterEnum + 1;
      return [tag.name, readFString(buf, at)[0], at + tag.size];
    }
    case 'StructProperty': {
      const [structType, afterType] = readFString(buf, at);
      at = afterType + 17;
      return [tag.name, decodeStruct(buf, structType, at, at + tag.size), at + tag.size];
    }
    case 'ArrayProperty':
    case 'SetProperty': {
      const [innerType, afterInner] = readFString(buf, at);
      at = afterInner + 1;
      return [tag.name, decodeArray(buf, innerType, at, at + tag.size), at + tag.size];
    }
    case 'MapProperty': {
      const [, afterKey] = readFString(buf, at);
      const [, afterValue] = readFString(buf, afterKey);
      at = afterValue + 1;
      return [tag.name, null, at + tag.size];
    }
    default: {
      at += 1;
      const reader = tag.type ? SCALAR_READERS[tag.type] : undefined;
      let value: PropertyValue = null;
      if (reader) value = reader(buf, at);
      else if (tag.type === 'NameProperty' || tag.type === 'StrProperty') value = readFString(buf, at)[0];
      return [tag.name, value, at + tag.size];
    }
  }
}

/** Read a 'None'-terminated property list starting at offset. */
export function readPropertyList(buf: SaveBuffer, offset: number, end = buf.length): [PropertyDict, number] {
  const fields: PropertyDict = {};
  while (offset < end) {
    const [name, value, next] = readPropertyValue(buf, offset);
    offset = next;
    if (name === null) break;
    fields[name] = value;
  }
  return [fields, offset];
}

export function decodeStruct(buf: SaveBuffer, structType: string, start: number, end: number): PropertyValue {
  if (structType === 'Guid') return end - start >= 16 ? formatGuid(buf.bytes, start) : null;
  if (structType === 'DateTime') return end - start >= 8 ? buf.i64(start) : null;
  if (structType === 'Vector') {
    const size = end - start;
    if (size >= 24) return { x: buf.f64(start), y: buf.f64(start + 8), z: buf.f64(start + 16) };
    if (size >= 12) return { x: buf.f32(start), y: buf.f32(start + 4), z: buf.f32(start + 8) };
    return null;
  }
  const [fields] = readPropertyList(buf, start, end);
  if (structType === 'FixedPoint64') {
    const value = fields['Value'];
    return typeof value === 'number' ? value / 1000 : null;
  }
  return fields;
}

export function decodeArray(buf: SaveBuffer, innerType: string, start: number, end: number): PropertyValue {
  const count = buf.i32(start);
  let at = start + 4;
  if (count < 0) return [];
  const values: PropertyValue[] = [];
  if (innerType === 'StructProperty') {
    const [, afterName] = readFString(buf, at);
    const [, afterType] = readFString(buf, afterName);
    at = afterType + 8;
    const [structType, afterStruct] = readFString(buf, at);
    at = afterStruct + 17;
    for (let i = 0; i < count; i++) {
      if (structType === 'Guid') {
        values.push(formatGuid(buf.bytes, at));
        at += 16;
      } else if (structType === 'DateTime') {
        values.push(buf.i64(at));
        at += 8;
      } else {
        const [fields, next] = readPropertyList(buf, at, end);
        values.push(fields);
        at = next;
      }
    }
    return values;
  }
  if (innerType === 'EnumProperty' || innerType === 'NameProperty' || innerType === 'StrProperty') {
    for (let i = 0; i < count; i++) {
      const [value, next] = readFString(buf, at);
      values.push(value);
      at = next;
    }
    return values;
  }
  if (innerType === 'BoolProperty') {
    for (let i = 0; i < count; i++) values.push(buf.bytes[at + i] !== 0);
    return values;
  }
  if (innerType === 'ByteProperty') {
    return buf.bytes.slice(at, at + count);
  }
  const reader = SCALAR_READERS[innerType];
  const step = SCALAR_SIZES[innerType];
  if (reader && step) {
    for (let i = 0; i < count; i++) values.push(reader(buf, at + i * step));
  }
  return values;
}

export function readStructProperty(buf: SaveBuffer, offset: number): PropertyValue {
  if (offset === -1) return null;
  return guarded(() => {
    const payload = readStructPayload(buf, offset);
    if (!payload) return null;
    return decodeStruct(buf, payload.structType, payload.start, payload.end);
  }, null);
}

export function readStructArrayProperty(buf: SaveBuffer, offset: number): PropertyValue[] {
  if (offset === -1) return [];
  return guarded(() => {
    const tag = readTagHeader(buf, offset);
    if (tag.type !== 'ArrayProperty') return [];
    const [innerType, afterInner] = readFString(buf, tag.offset);
    const at = afterInner + 1;
    const decoded = decodeArray(buf, innerType, at, at + tag.size);
    return Array.isArray(decoded) ? decoded : [];
  }, []);
}

export function asDict(value: PropertyValue | undefined): PropertyDict {
  return value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Uint8Array)
    ? (value as PropertyDict)
    : {};
}

/* --------------------------------------------------------------------- maps */

interface MapHeader {
  first: number;
  count: number;
  end: number;
}

function mapHeader(buf: SaveBuffer, label: string): MapHeader | null {
  const offset = findPropertyStart(buf, label);
  if (offset === -1) return null;
  const tag = readTagHeader(buf, offset);
  if (tag.type !== 'MapProperty') return null;
  const [, afterKey] = readFString(buf, tag.offset);
  const [, afterValue] = readFString(buf, afterKey);
  const at = afterValue + 1;
  return { first: at + 8, count: buf.i32(at + 4), end: at + tag.size };
}

export function mapEntryCount(buf: SaveBuffer, label: string): number {
  return mapHeader(buf, label)?.count ?? 0;
}

/** Iterate (key, value) of a MapProperty whose values are property lists. */
export function* readMapEntries(
  buf: SaveBuffer,
  label: string,
  keyKind: 'properties' | 'guid' = 'properties'
): Generator<[PropertyValue, PropertyDict]> {
  const header = mapHeader(buf, label);
  if (!header) return;
  let offset = header.first;
  for (let i = 0; i < header.count; i++) {
    if (offset >= header.end) return;
    let key: PropertyValue;
    if (keyKind === 'guid') {
      key = formatGuid(buf.bytes, offset);
      offset += 16;
    } else {
      [key, offset] = readPropertyList(buf, offset, header.end);
    }
    const [value, next] = readPropertyList(buf, offset, header.end);
    offset = next;
    yield [key, value];
  }
}

/**
 * Every property name that appears in [start, end) with a plausible tag header, in
 * order of first appearance.
 */
export function validatedPropertyNames(buf: SaveBuffer, start: number, end: number): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  const pattern = /[A-Za-z][A-Za-z0-9_]{2,64}\0/g;
  pattern.lastIndex = start;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(buf.text)) !== null && match.index < end) {
    const pos = match.index;
    if (pos - start < 4) continue;
    let header: TagHeader;
    try {
      // Reads are limited to the block.
      header = readTagHeader(buf, pos - 4, end);
    } catch (error) {
      if (error === READ_ERROR || error instanceof RangeError) continue;
      throw error;
    }
    if (!header.type || !header.type.endsWith('Property')) continue;
    if (!seen.has(header.name)) {
      seen.add(header.name);
      names.push(header.name);
    }
  }
  return names;
}
