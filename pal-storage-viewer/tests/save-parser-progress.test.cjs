const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);

// Exercise the worker's actual message stream without downloading the decoder.
function workerHarness() {
  const messages = [];
  let parses = 0;
  const backend = {
    decodeSave: bytes => {
      if (bytes[0] === 9) throw new Error('Invalid save');
      return bytes;
    },
    parseSaveFile: (bytes, lookups, progress, onKind) => {
      parses++;
      const kind = ['level', 'level_meta', 'player', 'dimensional_storage'][bytes[0]];
      onKind(kind);
      if (kind === 'level' || kind === 'dimensional_storage') {
        const unit = kind === 'level' ? 'entries' : 'pals';
        progress(0, 100, 0, unit);
        progress(50, 100, 40, unit);
        progress(100, 100, 80, unit);
      }
      return { kind, payload: {} };
    },
    combineSaves: entries => ({ entries }),
  };
  const source = fs.readFileSync(require.resolve('../src/app/save-parser.worker.ts'), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const context = {
    exports: {}, URL, Uint8Array,
    require: name => {
      if (name === '../backend') return backend;
      if (name === '../backend/save-preview') return {};
      if (name === './save-file-labels') return require('../src/app/save-file-labels.ts');
      throw new Error(`Unexpected import: ${name}`);
    },
    self: {
      location: { href: 'https://example.test/worker.js' },
      addEventListener() {},
      postMessage: message => messages.push(message),
    },
  };
  vm.runInNewContext(compiled + `
    oozPromise = Promise.resolve({});
    lookupsPromise = Promise.resolve({});
    exports.run = handleParse;
  `, context);
  return { messages, run: context.exports.run, parses: () => parses };
}

function file(name, size, kind) {
  return {
    name, set: 'world', letter: 'A',
    file: { name, size, lastModified: 1, arrayBuffer: async () => Uint8Array.of(kind).buffer },
  };
}

function assertMonotonic(messages) {
  const updates = messages.filter(message => message.type === 'progress');
  assert.ok(updates.length > 0);
  let previous = 0;
  for (const update of updates) {
    assert.ok(update.fraction >= previous, `${update.detail}: ${update.fraction} < ${previous}`);
    assert.ok(update.fraction <= 1);
    previous = update.fraction;
  }
  assert.equal(previous, 1);
  assert.equal(messages.at(-1).type, 'result');
  return updates;
}

test('batch progress stays monotonic while individual file stages and counts update', async () => {
  const worker = workerHarness();
  const files = [
    file('Level.sav', 800, 0), file('LevelMeta.sav', 10, 1),
    file('00000000000000000000000000000001.sav', 20, 2),
    file('00000000000000000000000000000001_dps.sav', 170, 3),
  ];
  await worker.run({ id: 1, files });
  const updates = assertMonotonic(worker.messages);
  const details = updates.map(update => update.detail);
  for (let index = 1; index <= files.length; index++) {
    assert.ok(updates.some(update => update.label === `Loading saves · File ${index} of ${files.length}`));
  }
  assert.ok(details.every(detail => !detail.startsWith('File ')));
  assert.ok(details.includes('Level.sav: Decompressing'));
  assert.ok(details.includes('Level.sav: Reading Pals: 50 / 100'));
  assert.ok(details.includes('LevelMeta.sav: Reading world metadata'));
  assert.ok(details.includes('00000000000…00000001.sav: Reading player progress'));
  assert.ok(details.includes('00000000000…0001_dps.sav: Reading Pals: 50 / 100'));
  assert.ok(details.every(detail => !detail.includes('—')));
  const firstDone = updates.find(update => update.detail === 'Level.sav: Ready');
  assert.ok(Math.abs(firstDone.fraction - 0.8 * 0.95) < 1e-10);
  const nextStart = updates.find(update => update.detail === 'LevelMeta.sav: Decompressing');
  assert.equal(nextStart.fraction, firstDone.fraction);

  // A repeat batch can mix cached data with new files without resetting progress.
  worker.messages.length = 0;
  await worker.run({ id: 2, files: [...files, file('My very long renamed world backup.sav', 100, 0)] });
  assertMonotonic(worker.messages);
  assert.equal(worker.parses(), 5);
  assert.ok(worker.messages.some(message => message.detail === 'Level.sav: Using cached data'));
  assert.ok(worker.messages.some(message => message.detail === 'My very lon…d backup.sav: Reading Pals: 50 / 100'));
});

test('empty, unreadable and zero-size files finish their shares without invalid progress', async () => {
  const worker = workerHarness();
  await worker.run({ id: 1, files: [file('bad.sav', 0, 9), file('LevelMeta.sav', 0, 1)] });
  assertMonotonic(worker.messages);
  assert.ok(worker.messages.some(message => message.detail === 'bad.sav: Could not read file'));
  worker.messages.length = 0;
  await worker.run({ id: 2, files: [] });
  assertMonotonic(worker.messages);
});
