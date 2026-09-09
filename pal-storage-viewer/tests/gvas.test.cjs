const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText, filename);
const { SaveBuffer, findPropertyStart, readInt } = require('../src/backend/gvas.ts');

test('bounded byte searches return absolute offsets and reject partial or adjacent matches', () => {
  const buf = new SaveBuffer(Buffer.from('field|record field|field'));
  assert.equal(buf.find('field'), 0);
  assert.equal(buf.find('field', 6, 18), 13);
  assert.equal(buf.find('field', 6, 17), -1);
  assert.equal(buf.find('field', 6, 13), -1);
  assert.equal(buf.find('field', 18), 19);
  assert.equal(buf.find('missing', 6, 18), -1);
  assert.equal(buf.find('field', 30), -1);
  assert.equal(buf.find('field', -3), 0);
  assert.equal(buf.find('field', 19, 100), 19);
});

test('field lookup stays inside each record and keeps offsets suitable for value readers', () => {
  const i32 = value => { const b = Buffer.alloc(4); b.writeInt32LE(value); return b; };
  const str = value => Buffer.concat([i32(value.length + 1), Buffer.from(value + '\0')]);
  const property = (name, value) => Buffer.concat([str(name), str('IntProperty'), i32(4), i32(0), Buffer.from([0]), i32(value)]);
  const prefix = Buffer.from('header');
  const first = Buffer.concat([property('Level', 10), property('OptionalExtra', 2)]);
  const second = Buffer.concat([property('Level', 65), property('Optional', 42)]);
  const start = prefix.length;
  const boundary = start + first.length;
  const buf = new SaveBuffer(Buffer.concat([prefix, first, second]));
  assert.equal(readInt(buf, findPropertyStart(buf, 'Level', start, boundary)), 10);
  assert.equal(readInt(buf, findPropertyStart(buf, 'Level', boundary)), 65);
  assert.equal(findPropertyStart(buf, 'Optional', start, boundary), -1);
  assert.equal(readInt(buf, findPropertyStart(buf, 'Optional', boundary)), 42);
});
