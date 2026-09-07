const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const zlib = require('node:zlib');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText, filename);
const { resolveWgsFiles } = require('../src/backend/wgs.ts');
const { decodeSave } = require('../src/backend/decode.ts');
const u32 = value => { const b = Buffer.alloc(4); b.writeUInt32LE(value); return b; };
const str = text => Buffer.concat([u32(text.length), Buffer.from(text, 'utf16le')]);
const guid = id => { const b = Buffer.from(id, 'hex'); return Buffer.from([3,2,1,0,5,4,7,6,8,9,10,11,12,13,14,15].map(i => b[i])); };
const world = '00112233445566778899AABBCCDDEEFF';
const input = (path, bytes) => ({path, file: new File([bytes], path.split('/').pop(), {lastModified: 12345})});
function wgs(names, root = 'wgs/account/', packageName = 'PocketpairInc.Palworld_ad4psfrxyesvt') {
  const files = [];
  const entries = names.map((name, i) => {
    const folder = `112233445566778899aabbcc${String(i).padStart(8,'0')}`;
    const blob = `ffeeddccbbaa998877665544${String(i).padStart(8,'0')}`;
    const fixedName = Buffer.alloc(128); fixedName.write('Data', 'utf16le');
    files.push(input(`${root}${folder.toUpperCase()}/container.7`, Buffer.concat([u32(4),u32(1),fixedName,guid(blob),guid(blob)])));
    files.push(input(`${root}${folder.toUpperCase()}/${blob.toUpperCase()}`, Buffer.from(`GVAS${name}`)));
    return Buffer.concat([str(name),str(name),str(''),Buffer.from([7]),u32(0),guid(folder),Buffer.alloc(24)]);
  });
  files.push(input(root+'containers.index', Buffer.concat([u32(14),u32(entries.length),str(''),str(packageName),Buffer.alloc(12),str(''),Buffer.alloc(8),...entries])));
  return files;
}

test('WGS maps both Level names and player files, preserving bytes and separate worlds/accounts', async () => {
  const other = 'FFEEDDCCBBAA99887766554433221100';
  const names = [`${world}-Level-01`,`${world}-LevelMeta`,`${world}-Players-${world}`,`${world}-Players-${world}_dps`,`${other}-Level`];
  const files = wgs(names);
  const resolved = await resolveWgsFiles([...files,...wgs([`${world}-Level`],'wgs/second/')]);
  assert.equal(resolved.length, 6);
  assert.equal(resolved[0].path, `wgs/account/${world}/Level.sav`);
  assert.equal(resolved[2].path, `wgs/account/${world}/Players/${world}.sav`);
  assert.equal(resolved[3].file.name, `${world}_dps.sav`);
  assert.equal(resolved[4].path, `wgs/account/${other}/Level.sav`);
  assert.equal(resolved[5].path, `wgs/second/${world}/Level.sav`);
  assert.equal(await resolved[0].file.text(), 'GVAS'+names[0]);
  assert.equal(resolved[0].file.lastModified, 12345);
});
test('WGS skips backup slots/settings and unreferenced old container revisions', async () => {
  const files = wgs([`${world}-Level`,`${world}-Slot1-Level-01`,`${world}-LocalData`,'GDKBackupTimestamps','UserOption']);
  const current = files.find(f => f.file.name === 'container.7');
  files.push(input(current.path.replace('container.7','container.99'), Buffer.from('invalid old revision')));
  const resolved = await resolveWgsFiles(files);
  assert.deepEqual(resolved.map(f=>f.file.name), ['Level.sav']);
});
test('Xbox account backup directories are not loaded as extra worlds', async () => {
  const resolved = await resolveWgsFiles([
    ...wgs([`${world}-Level`]),
    ...wgs([`${world}-Level`], 'wgs/account_backup/')
  ]);
  assert.deepEqual(resolved.filter(f => f.file.name.endsWith('.sav')).map(f=>f.path), [`wgs/account/${world}/Level.sav`]);
});
test('a selected account folder works, and regular saves alongside WGS are preserved', async () => {
  const regular = input('Steam/Level.sav',Buffer.from('GVAS'));
  assert.deepEqual(await resolveWgsFiles([regular]), [regular]);
  const resolved = await resolveWgsFiles([regular,...wgs([`${world}-Level`],'Account/')]);
  assert.equal(resolved[0], regular);
  assert.equal(resolved[1].path, `Account/${world}/Level.sav`);
});
test('WGS incomplete metadata/blobs, unknown versions and wrong game produce useful errors', async () => {
  const files = wgs([`${world}-Level`]);
  await assert.rejects(resolveWgsFiles(files.filter(f=>f.file.name !== 'containers.index')), /missing containers.index/);
  await assert.rejects(resolveWgsFiles(files.filter(f=>f.file.name !== 'container.7')), /Missing container.7/);
  await assert.rejects(resolveWgsFiles(files.filter(f=>!/^[A-F0-9]{32}$/.test(f.file.name))), /Missing or ambiguous data/);
  await assert.rejects(resolveWgsFiles([input('containers.index',Buffer.from([14,0,0,0]))]), /Truncated/);
  await assert.rejects(resolveWgsFiles([input('containers.index',u32(15))]), /Unsupported WGS index/);
  await assert.rejects(resolveWgsFiles(wgs([`${world}-Level`],'Account/','Other.Game')), /not a Palworld/);
});
test('WGS GUID copies use the only present blob; ambiguous copies are rejected', async () => {
  const files = wgs([`${world}-Level`]);
  const metadata = files[0];
  const changed = Buffer.from(await metadata.file.arrayBuffer());
  const alternate = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  changed.set(guid(alternate),152);
  files[0] = input(metadata.path,changed);
  assert.equal((await resolveWgsFiles(files)).length,1);
  const altFile = input(files[1].path.replace(/[^/]+$/,alternate),Buffer.from('GVAS alternate'));
  const onlySecond = await resolveWgsFiles([files[0],files[2],altFile]);
  assert.equal(await onlySecond[0].file.text(),'GVAS alternate');
  await assert.rejects(resolveWgsFiles([...files,altFile]),/ambiguous/);
});
test('WGS refuses duplicate logical world files and unknown numbered Level parts', async () => {
  await assert.rejects(resolveWgsFiles(wgs([`${world}-Level`,`${world}-Level-01`])),/Multiple current/);
  await assert.rejects(resolveWgsFiles(wgs([`${world}-Level-02`])),/Unsupported Xbox world part/);
});
const raw = Buffer.from('GVAS test save payload');
const unusedOodle = {decompress() {throw new Error('Should not call Oodle for zlib.');}};
function compressed(format) {
  const first = zlib.deflateSync(raw);
  const payload = format === 'PlZ2' ? zlib.deflateSync(first) : first;
  return Buffer.concat([u32(raw.length),u32(first.length),Buffer.from(format),payload]);
}
test('save decoder handles GVAS, single/double zlib, and CNK0-wrapped double zlib', async () => {
  assert.deepEqual(await decodeSave(raw, unusedOodle),raw);
  for (const format of ['PlZ1','PlZ2']) assert.deepEqual(Buffer.from(await decodeSave(compressed(format),unusedOodle)),raw);
  const cnk = Buffer.concat([u32(3297),u32(1),Buffer.from('CNK0'),compressed('PlZ2')]);
  assert.deepEqual(Buffer.from(await decodeSave(cnk,unusedOodle)),raw);
  assert.deepEqual(Buffer.from(await decodeSave(Buffer.concat([cnk, Buffer.from('leftover bytes from Xbox')]),unusedOodle)),raw);
  cnk.writeUInt32LE(2,4);
  assert.throws(() => decodeSave(cnk,unusedOodle),/variant is not supported/);
});
test('existing Oodle saves still use the injected decoder with validated lengths', async () => {
  const bytes = Buffer.concat([u32(raw.length),u32(3),Buffer.from('PlM1'),Buffer.from([1,2,3])]);
  const decoder = {decompress(payload,size) {assert.equal(size,raw.length); assert.deepEqual([...payload],[1,2,3]); return raw;}};
  assert.deepEqual(Buffer.from(await decodeSave(bytes,decoder)),raw);
  assert.throws(() => decodeSave(bytes.subarray(0,-1),decoder),/incorrect length/);
});
test('save decoder rejects truncation, incorrect lengths, and non-GVAS output', async () => {
  assert.throws(() => decodeSave(Buffer.from('PlZ'),unusedOodle),/truncated/);
  const broken=compressed('PlZ2');broken.writeUInt32LE(1,0);
  assert.throws(() => decodeSave(broken,unusedOodle),/incorrect length/);
  const payload=zlib.deflateSync(Buffer.from('not a save'));
  assert.throws(() => decodeSave(Buffer.concat([u32(10),u32(payload.length),Buffer.from('PlZ1'),payload]),unusedOodle),/not a GVAS/);
  assert.throws(() => decodeSave(compressed('PlZ1').subarray(0,-1),unusedOodle),/incorrect length/);
});
