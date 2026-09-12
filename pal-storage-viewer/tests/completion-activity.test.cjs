const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { SaveBuffer } = require('../src/backend/gvas.ts');
const { extractPlayerCompletion, extractSeenSpecies, extractCheckedNotes } = require('../src/backend/completion.ts');
const int = value => { const bytes = Buffer.alloc(4); bytes.writeInt32LE(value); return bytes; };
const str = value => Buffer.concat([int(value.length + 1), Buffer.from(value + '\0')]);
const tag = (name, type, size) => Buffer.concat([str(name), str(type), int(size), int(0)]);
const record = Buffer.concat([tag('RecordData', 'IntProperty', 4), Buffer.from([0]), int(0)]);
function countMap(name, entries) {
  const body = Buffer.concat([int(0), int(entries.length), ...entries.flatMap(([key, value]) => [str(key), int(value)])]);
  return Buffer.concat([tag(name, 'MapProperty', body.length), str('NameProperty'), str('IntProperty'), Buffer.from([0]), body]);
}

test('activity maps preserve per-item counts for unions and distinguish missing data from zero', () => {
  const missing = extractPlayerCompletion(new SaveBuffer(record));
  assert.equal(missing.crafted_item_counts, null);
  assert.equal(missing.fishing_counts, null);
  assert.equal(missing.butcher_counts, null);
  assert.equal(missing.counters.awakenings, null);
  const empty = extractPlayerCompletion(new SaveBuffer(Buffer.concat([record, countMap('CraftItemCount', []), countMap('FishingCountMap', [])])));
  assert.deepEqual(empty.crafted_item_counts, {});
  assert.deepEqual(empty.fishing_counts, {});
  const populated = extractPlayerCompletion(new SaveBuffer(Buffer.concat([record,
    countMap('CraftItemCount', [['PalSphere', 560], ['Cloth', 321], ['UnusedRecipe', 0]]),
    countMap('FishingCountMap', [['FishShadow_StuffedShark_Common', 2], ['FishShadow_StuffedShark_Boss', 1]]),
  ])));
  assert.deepEqual(populated.crafted_item_counts, { PalSphere: 560, Cloth: 321, UnusedRecipe: 0 });
  assert.deepEqual(populated.fishing_counts, { FishShadow_StuffedShark_Common: 2, FishShadow_StuffedShark_Boss: 1 });
});

test('awakening and butchering counters retain recorded zeroes and per-species totals', () => {
  const read = value => extractPlayerCompletion(new SaveBuffer(Buffer.concat([record,
    tag('AwakeningCount', 'IntProperty', 4), Buffer.from([0]), int(value),
    countMap('PalButcherCount', [['Penguin', 12], ['Human', 2], ['SheepBall', 0]]),
  ])));
  assert.equal(read(0).counters.awakenings, 0);
  assert.equal(read(9).counters.awakenings, 9);
  assert.deepEqual(read(9).butcher_counts, { Penguin: 12, Human: 2, SheepBall: 0 });
});

test('local encounter and journal flags preserve false entries and missing-file distinction', () => {
  const seen = (entries, name = 'Local_PalEncountFlag') => {
    const body = Buffer.concat([int(0), int(entries.length), ...entries.flatMap(([id, value]) => [str(id), Buffer.from([value ? 1 : 0])])]);
    return new SaveBuffer(Buffer.concat([tag(name, 'MapProperty', body.length), str('EnumProperty'), str('BoolProperty'), Buffer.from([0]), body]));
  };
  assert.equal(extractSeenSpecies(new SaveBuffer(record)), null);
  assert.deepEqual(extractSeenSpecies(seen([])), []);
  assert.deepEqual(extractSeenSpecies(seen([['EPalTribeID::Penguin', true], ['EPalTribeID::SheepBall', false], ['EPalTribeID::None', true]])), ['Penguin']);
  assert.equal(extractCheckedNotes(new SaveBuffer(record)), null);
  assert.deepEqual(extractCheckedNotes(seen([], 'Local_NoteCheckedFlag')), []);
  assert.deepEqual(extractCheckedNotes(seen([['Day0', true], ['GrassBoss3', false]], 'Local_NoteCheckedFlag')), ['Day0']);
});
