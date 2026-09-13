const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText, filename);
const { SaveBuffer, formatGuid } = require('../src/backend/gvas.ts');
const { buildRecord } = require('../src/backend/record.ts');
const { extractLevel } = require('../src/backend/saves.ts');
const { Lookups } = require('../src/backend/lookups.ts');
const lookups = new Lookups({ palTraitsJson: fs.readFileSync(require.resolve('../../resources/pal_traits_lookup.json'), 'utf8') });
const i32 = value => { const b = Buffer.alloc(4); b.writeInt32LE(value); return b; };
const str = value => Buffer.concat([i32(value.length + 1), Buffer.from(value + '\0')]);
const end = str('None');
const tag = (name, type, value, extra = Buffer.alloc(0)) => Buffer.concat([str(name), str(type), i32(value.length), i32(0), extra, Buffer.from([0]), value]);
const struct = (name, type, value) => tag(name, 'StructProperty', value, Buffer.concat([str(type), Buffer.alloc(16)]));
const guid = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
const slot = (name, index) => struct(name, 'PalCharacterSlotId', Buffer.concat([
  struct('ContainerId', 'PalCharacterContainerId', Buffer.concat([struct('ID', 'Guid', guid), end])),
  tag('SlotIndex', 'IntProperty', i32(index)), end,
]));
const level = (type, value) => type === 'ByteProperty'
  ? tag('Level', type, Buffer.from([value]), str('None')) : tag('Level', type, i32(value));
const pal = (...fields) => {
  const buf = new SaveBuffer(Buffer.concat([tag('CharacterID', 'NameProperty', str('Bastet')), ...fields, end]));
  return buildRecord(buf, 0, buf.length, 0, lookups);
};

test('older SlotID and integer levels produce the same locations and derived stats as current saves', () => {
  const current = pal(slot('SlotId', 86), level('ByteProperty', 24));
  const older = pal(slot('SlotID', 86), level('IntProperty', 24));
  assert.deepEqual(older.pal_box, { container_id: formatGuid(guid, 0), slot_index: 86 });
  assert.equal(older.level, 24);
  assert.deepEqual(older.pal_box, current.pal_box);
  assert.equal(older.level, current.level);
  assert.deepEqual(older.derived, current.derived);
  assert.notEqual(older.derived.max_hp, pal(level('ByteProperty', 1)).derived.max_hp);
});

test('current slot spelling takes precedence and missing fields keep their defaults', () => {
  assert.equal(pal(slot('SlotID', 9), slot('SlotId', 0)).pal_box.slot_index, 0);
  const missing = pal();
  assert.equal(missing.level, 1);
  assert.equal(missing.pal_box.container_id, null);
  assert.equal(missing.pal_box.slot_index, undefined);
});

test('player levels support both byte and integer properties without inventing missing levels', () => {
  const player = levelField => {
    const raw = Buffer.concat([str('IsPlayer'), str('BoolProperty'), i32(0), i32(0), Buffer.from([1, 0]), levelField, end]);
    const key = Buffer.concat([struct('PlayerUId', 'Guid', guid), struct('InstanceId', 'Guid', guid), end]);
    const value = Buffer.concat([tag('RawData', 'ArrayProperty', Buffer.concat([i32(raw.length), raw]), str('ByteProperty')), end]);
    const map = tag('CharacterSaveParameterMap', 'MapProperty', Buffer.concat([i32(0), i32(1), key, value]), Buffer.concat([str('StructProperty'), str('StructProperty')]));
    return extractLevel(new SaveBuffer(map), lookups).players[0];
  };
  assert.equal(player(level('IntProperty', 50)).level, 50);
  assert.deepEqual(player(level('IntProperty', 50)), player(level('ByteProperty', 50)));
  assert.equal(player(Buffer.alloc(0)).level, null);
});
