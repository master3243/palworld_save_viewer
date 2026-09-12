const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { countDistinctItems } = require('../src/backend/player-progress.ts');
const { combineSaves } = require('../src/backend/combine.ts');
const int = n => { const b = Buffer.alloc(4); b.writeInt32LE(n); return b; };
const slot = (id, count) => ({ RawData: Buffer.concat([int(0), int(count), int(id.length + 1), Buffer.from(id + '\0')]) });

test('key-item count deduplicates IDs, ignores empty stacks and reports unreadable slots', () => {
  assert.equal(countDistinctItems([slot('Key1', 2), slot('KEY1', 5), slot('Key2', 1), slot('None', 0), slot('Key3', 0)]), 2);
  assert.equal(countDistinctItems([]), 0);
  assert.equal(countDistinctItems(undefined), null);
  assert.equal(countDistinctItems([{ RawData: Buffer.from([1, 2]) }]), null);
});

test('world data joins attributes and key items to the correct player in either file order', () => {
  const entry = (kind, payload, set = 'world') => ({ name: kind, set, letter: 'A', parsed: { kind, payload, class_name: '', saved_at: '' } });
  const attrs = { allocated: { HP: 3 }, extra: {} };
  const world = entry('level', { records: [], bases: [], labs: [], containers: {}, item_counts: { bagA: 87, bagB: 0 },
    players: [{ player_uid: 'a', name: 'A', level: 80, attributes: attrs, arena_points: 28070 }, { player_uid: 'b', name: 'B', level: 1, attributes: null, arena_points: 0 }], skipped: {} });
  const a = entry('player', { player_uid: 'a', key_item_container_id: 'bagA', completion: {} });
  const b = entry('player', { player_uid: 'b', key_item_container_id: 'bagB', completion: {} });
  const local = entry('local_data', { seen_species: ['Penguin'], checked_notes: ['Day0'] });
  for (const files of [[world, a, b, local], [local, b, a, world]]) {
    const set = combineSaves(files).sets[0];
    assert.equal(set.players.find(p => p.uid === 'a').key_items, 87);
    assert.equal(set.players.find(p => p.uid === 'b').key_items, 0);
    assert.deepEqual(set.players.find(p => p.uid === 'a').attributes, attrs);
    assert.equal(set.players.find(p => p.uid === 'a').arena_points, 28070);
    assert.equal(set.players.find(p => p.uid === 'b').arena_points, 0);
    assert.deepEqual(set.seen_species, ['Penguin']);
    assert.deepEqual(set.checked_notes, ['Day0']);
    assert.equal(set.has_local_data, true);
  }
  assert.equal(combineSaves([a]).sets[0].players[0].key_items, null);
  assert.equal(combineSaves([a]).sets[0].players[0].arena_points, null);
  assert.equal(combineSaves([world, a, entry('local_data', { seen_species: ['Penguin'] }, 'other')]).sets[0].seen_species, null);
  assert.equal(combineSaves([a, local, local]).sets[0].seen_species, null);
  assert.equal(combineSaves([a, local, local]).sets[0].checked_notes, null);
  assert.equal(combineSaves([a]).sets[0].checked_notes, null);
});
