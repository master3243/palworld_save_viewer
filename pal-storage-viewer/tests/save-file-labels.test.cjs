const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText, filename);
const { sourceBlurb, sourceTitle } = require('../src/app/save-file-labels.ts');
const source = (kind, extra = {}) => ({ file: 'test.sav', set: 'world-a', kind, kind_label: kind, pals: 0, note: '', ...extra });

test('metadata labels use the day and world from that file, including day zero', () => {
  const meta = source('level_meta', { world_name: 'All Blue', in_game_day: 0 });
  assert.equal(sourceBlurb(meta, { world_name: 'Another world', in_game_day: 99 }), 'All Blue - day 0');
  assert.match(sourceTitle(meta), /world: All Blue · day 0/);
  assert.equal(sourceBlurb(source('level_meta'), null), 'Unknown world');
  assert.doesNotMatch(sourceTitle(source('level_meta')), /day/);
});

test('player names resolve within their own world even when UIDs are shared', () => {
  const file = source('player', { player_uid: '00000000000000000000000000000001' });
  const first = { players: [{ uid: file.player_uid, name: 'Church' }] };
  const second = { players: [{ uid: file.player_uid, name: 'Diavolo' }] };
  assert.equal(sourceBlurb(file, first), 'Church');
  assert.equal(sourceBlurb(file, second), 'Diavolo');
  assert.equal(sourceBlurb(file, null), 'Player …0001');
  assert.match(sourceTitle(file, first, 42.7), /player: Church · 42.7% progress/);
  assert.match(sourceTitle(file, second, 0), /player: Diavolo · 0% progress/);
  assert.match(sourceTitle(file, null), /progress unavailable/);
});

test('world and DPS chips show Pal counts, including empty files, without redundant world filenames', () => {
  const world = source('level', { kind_label: 'World (Level.sav)', players: 0, bases: 0 });
  assert.equal(sourceBlurb(world, null), '0 Pals');
  assert.equal(sourceTitle(world), 'World · folder: world-a · 0 pals · 0 players · 0 bases');
  const dps = source('dimensional_storage', { pals: 1935, kind_label: 'Dimensional storage', note: 'Example note' });
  assert.equal(sourceBlurb(dps, null), `${(1935).toLocaleString()} Pals`);
  assert.equal(sourceTitle(dps), `Dimensional storage · folder: world-a · ${(1935).toLocaleString()} pals · Example note`);
});
