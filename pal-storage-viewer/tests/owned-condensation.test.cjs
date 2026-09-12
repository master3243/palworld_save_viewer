const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { ownedCondensation } = require('../src/app/completion/owned-condensation.ts');

test('owned condensation uses exact ranks, canonical species, owner, save, and unique instances', () => {
  const row = (id, rank, extra = {}) => ({ save_id: 'A', owner_player_uid: 'ab-cd', instance_id: id,
    species_base_id: 'Penguin', species_id: 'BOSS_Penguin', rank, ...extra });
  const rows = [row('01', 2), row('02', 3), row('03', 4), row('04', 5), row('05', 5),
    row('04', 5), row('06', 5, { owner_player_uid: 'other' }), row('07', 5, { save_id: 'B' }),
    row('08', 1), row('09', null), row('16', undefined), row('10', 6), row('11', 2.5), row('17', 0),
    row('12', 2, { species_base_id: 'Penguin_Electric', owner_player_uid: 'ABCD' }),
    row('13', 2, { species_base_id: 'PENGUIN' }),
    row('14', 3, { owner_player_uid: null, instance_player_uid: 'ABCD' }),
    row('15', 3, { owner_player_uid: 'other', instance_player_uid: 'ABCD' })];
  assert.deepEqual(ownedCondensation(rows, 'A', 'abcd'), { penguin: [3, 2, 2, 1, 2], penguin_electric: [0, 1, 0, 0, 0] });
  assert.deepEqual(ownedCondensation(rows, 'A', ''), {});
  assert.deepEqual(ownedCondensation([], 'A', 'abcd'), {});
});
