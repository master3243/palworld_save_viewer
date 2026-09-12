const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, f);
const { localOwnerFilters, identifiedLocalOwner, extractOwnerQuests, extractLocalOwnerEvidence } = require('../src/backend/local-data-owner.ts');
const { SaveBuffer } = require('../src/backend/gvas.ts');
const local = extra => ({ playerUids: [], instanceIds: [], containerIds: [], trackedQuest: null, ...extra });
const pal = (id, owner) => ({ identity: { instance_id: id }, ownership: { owner_player_uid: owner } });
const int = n => { const b = Buffer.alloc(4); b.writeInt32LE(n); return b; };
const str = s => Buffer.concat([int(s.length + 1), Buffer.from(s + '\0')]);
const nameProperty = (name, value) => Buffer.concat([str(name), str('NameProperty'), int(str(value).length), int(0), Buffer.from([0]), str(value)]);
const names = (name, values) => {
  const body = Buffer.concat([int(values.length), ...values.map(str)]);
  return Buffer.concat([str(name), str('ArrayProperty'), int(body.length), int(0), str('NameProperty'), Buffer.from([0]), body]);
};
test('intersects all five rules and preserves each exclusion reason', () => {
  const players = [{ uid: 'a', containers: ['party-a'], notes: ['note'], quests: ['quest'] },
    { uid: 'b', containers: ['party-b'], notes: [], quests: [] }];
  const result = localOwnerFilters(local({ playerUids: ['a'], instanceIds: ['pal'], containerIds: ['party-a'], trackedQuest: 'quest' }), ['note'], players, [pal('pal', 'a')]);
  assert.deepEqual(result.a, []);
  assert.equal(result.b.length, 5);
});
test('missing data, zero owners, and unmatched Pal IDs do not exclude candidates', () => {
  const result = localOwnerFilters(local({ instanceIds: ['missing', 'unowned'], containerIds: ['party'], trackedQuest: 'quest' }), ['note'],
    [{ uid: 'a', quests: null, notes: null }], [pal('unowned', '00000000-0000-0000-0000-000000000000')]);
  assert.deepEqual(result, { a: [] });
});
test('unloaded owner excludes all loaded candidates; mixed references union within each rule', () => {
  assert.equal(localOwnerFilters(local({ playerUids: ['absent'] }), null, [{ uid: 'a' }], []).a.length, 1);
  assert.deepEqual(localOwnerFilters(local({ playerUids: ['a', 'b'], instanceIds: ['one', 'two'] }), null,
    [{ uid: 'a' }, { uid: 'b' }], [pal('one', 'a'), pal('two', 'b')]), { a: [], b: [] });
});
test('different rules can produce an empty intersection', () => {
  const result = localOwnerFilters(local({ playerUids: ['a'], trackedQuest: 'quest' }), null,
    [{ uid: 'a', quests: [] }, { uid: 'b', quests: ['quest'] }], []);
  assert.ok(Object.values(result).every(reasons => reasons.length));
});
test('extracts tracked NameProperty and accepts completed quests in legacy and modern arrays', () => {
  for (const name of ['CompletedQuestArray', 'CompletedQuestArray_FullRelease']) {
    const buf = new SaveBuffer(Buffer.concat([nameProperty('TrackingQuestId', 'Main_Quest'), names(name, ['Main_Quest'])]));
    assert.equal(extractLocalOwnerEvidence(buf).trackedQuest, 'Main_Quest');
    assert.deepEqual(extractOwnerQuests(buf), ['Main_Quest']);
  }
  assert.equal(extractOwnerQuests(new SaveBuffer(Buffer.alloc(0))), null);
  assert.deepEqual(extractOwnerQuests(new SaveBuffer(names('CompletedQuestArray', []))), []);
});

test('identification requires ID evidence and rejects conflicting ID rules', () => {
  const players = [{ uid: 'a', containers: ['party-a'], notes: ['note'], quests: ['quest'] },
    { uid: 'b', containers: ['party-b'], notes: [], quests: [] }];
  assert.equal(identifiedLocalOwner(local({ trackedQuest: 'quest' }), players, []), null);
  assert.equal(identifiedLocalOwner(local({}), [players[0]], []), null);
  assert.equal(identifiedLocalOwner(local({ containerIds: ['party-a'] }), players, []), 'a');
  assert.equal(identifiedLocalOwner(local({ playerUids: ['a'], containerIds: ['party-b'] }), players, []), null);
  assert.equal(identifiedLocalOwner(local({ instanceIds: ['pal'] }), players, [pal('pal', 'a')]), 'a');
  assert.equal(identifiedLocalOwner(local({ playerUids: ['absent'] }), players, []), 'absent');
});
