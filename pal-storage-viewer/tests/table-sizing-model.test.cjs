const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const context = { exports: {}, require: name => name === '@angular/common'
  ? { formatNumber: value => new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(value) }
  : { palWikiLinks: () => [{ label: 'Wiki' }] } };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../src/app/completion/table-sizing-model.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, context);
const { trackerSizingColumns } = context.exports;
const options = { pal: false, fishing: false, details: true, suffixes: [], stateLabel: () => 'Missing', itemIcon: () => false };

test('sizing includes every category value, escapes text, and supplies no prescribed widths', () => {
  const category = { key: 'notes', hasCoords: true, items: [
    { name: 'Short', detail: '', checked: null, coords: '' },
    { name: 'A much longer off-screen name <img src=x onerror=alert(1)>', detail: 'A & B', checked: true, coords: '12, 34', map: 'World Tree' },
  ] };
  const columns = trackerSizingColumns(category, options);
  assert.deepEqual(Array.from(columns, column => column.className), ['state-col', 'name-col', 'checked-col', 'detail-col', 'coords-col']);
  const names = columns[1].values.join('');
  assert.match(names, /off-screen name &lt;img/);
  assert.doesNotMatch(names, /<img/);
  assert.match(columns[3].values.join(''), /A &amp; B/);
  assert.match(columns[4].values.join(''), /World Tree/);
  assert.equal(columns[0].values.length, 1, 'identical values only need measuring once');
  for (const column of columns) assert.deepEqual(Object.keys(column), ['className', 'values']);
});

test('capture sizing matches displayed counts, suffixes, unknowns, and fishing column positions', () => {
  const category = { key: 'captureBonus', hasNumbers: true, items: [
    { name: 'Pal', no: 5, captureProgress: { done: 3, total: 5 }, butchered: null, condensed: null },
    { name: 'Other', no: 123, captureProgress: { done: 10000, total: 5 }, butchered: 1200, condensed: [0, 2, 0, 0, 1], fishing: { common: 4, whopper: 0, lunker: 2 } },
  ] };
  const columns = trackerSizingColumns(category, { ...options, pal: true, fishing: true, details: false, suffixes: ['B', ''] });
  assert.equal(columns.length, 15);
  assert.match(columns[1].values[0], /005<small>B<\/small>/);
  assert.match(columns[4].values[1], /10,000<span>\/5<\/span>/);
  assert.deepEqual(Array.from(columns[5].values), ['?', '1,200']);
  assert.deepEqual(Array.from(columns[6].values), ['?', '']);
  assert.deepEqual(Array.from(columns.slice(11, 14), column => column.className), ['fishing-col', 'fishing-col', 'fishing-col']);
  assert.equal(columns[14].className, 'pal-links-col');
});
