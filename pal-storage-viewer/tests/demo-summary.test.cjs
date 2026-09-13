const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { playerWorldProgress } = require('../src/app/completion/player-world-progress.ts');
function harness() {
  const worlds = [];
  const context = { exports: {}, require: name => name === './completion/player-world-progress' ? { playerWorldProgress }
    : { summarize: (completion, _data, world) => {
      worlds.push(world);
      return { percent: completion.percent + (world.checkedNotes?.length ?? 0) };
    } } };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../src/app/demo-summary.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, context);
  return { score: sets => JSON.parse(JSON.stringify(context.exports.demoSummary(sets, [], {}))), worlds };
}
const player = (uid, level, percent) => ({ uid, level, completion: percent === null ? null : { percent } });
const world = (players, extra = {}) => ({ players, in_game_day: 100, has_level: true, has_local_data: true,
  bases: [], letter: 'A', seen_species: ['SheepBall'], checked_notes: ['one','two'], max_friendship: 500, ...extra });

test('completion and level are independent maxima; every owner not ruled out receives LocalData', () => {
  const { score, worlds } = harness();
  const result = score([world([player('a', 30, 70), player('b', 80, 40)])]);
  assert.deepEqual(result, { percent: 72, level: 80, day: 100, players: 2 });
  assert(worlds.every(w => w.checkedNotes.length === 2 && w.seenSpecies.length === 1 && w.maxFriendship === 500));
});

test('ruled-out owners and saves without LocalData do not receive its progress', () => {
  const { score, worlds } = harness();
  assert.equal(score([world([player('a', 30, 70), player('b', 80, 71)], {
    local_owner_filters: { b: ['Referenced player ID does not match.'] },
  })]).percent, 72);
  assert.equal(worlds[1].checkedNotes, null);
  assert.equal(worlds[1].seenSpecies, null);
  assert.equal(worlds[1].maxFriendship, null);
  assert.equal(score([world([player('a', 30, 70)], { has_local_data: false })]).percent, 70);
});

test('repeated players count once across snapshots and latest day is shown', () => {
  const { score } = harness();
  assert.deepEqual(score([
    world([player('AA-BB', 25, 30)], { in_game_day: 20 }),
    world([player('aabb', 50, 65)], { in_game_day: 130 }),
  ]), { percent: 67, level: 50, day: 130, players: 1 });
});

test('missing stats stay unknown; players without completion still count and contribute their level', () => {
  const { score } = harness();
  assert.deepEqual(score([world([player('a', null, null)], { in_game_day: null })]), { percent: null, level: null, day: null, players: 1 });
  assert.deepEqual(score([world([player('a', 50, null), player('b', 10, 0)], { in_game_day: 0, has_local_data: false })]),
    { percent: 0, level: 50, day: 0, players: 2 });
});
