/** Recompute picker metadata after changing saves or tracker scoring; no browser downloads required. */
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { Lookups, decodeSave, parseSaveFile, combineSaves } = require('../src/backend/index.ts');
const { demoSummary } = require('../src/app/demo-summary.ts');
const root = path.resolve(__dirname, '../..');
(async () => {
  const ooz = await import(pathToFileURL(path.join(root, 'resources/browser/ooz-index.js')));
  const lookups = new Lookups(Object.fromEntries(Object.entries({ activeSkillsJson: 'active_skills', passiveSkillsJson: 'passive_skills', palNamesJson: 'pal_names', palTraitsJson: 'pal_traits', skillDetailsJson: 'skill_details' })
    .map(([key, name]) => [key, fs.readFileSync(path.join(root, 'resources', name + '_lookup.json'), 'utf8')])));
  const data = JSON.parse(fs.readFileSync(path.join(root, 'resources/completion/completion-data.json')));
  const filename = path.join(root, 'resources/demo-saves/catalog.json');
  const demos = JSON.parse(fs.readFileSync(filename));
  for (const demo of demos) {
    const entries = [], letters = new Map();
    for (const file of demo.files) {
      const parts = file.path.split('/'), name = parts.pop();
      if (parts.at(-1)?.toLowerCase() === 'players') parts.pop();
      const set = parts.join('/');
      if (!letters.has(set)) letters.set(set, String.fromCharCode(65 + letters.size));
      const parsed = parseSaveFile(decodeSave(fs.readFileSync(path.join(root, file.url)), ooz), lookups);
      entries.push({ key: file.path, name, set, letter: letters.get(set), parsed });
    }
    const combined = combineSaves(entries, lookups);
    demo.summary = demoSummary(combined.sets, combined.rows, data);
    // Player count now has its own summary line.
    demo.description = demo.description.replace(/^\d+ players?\.\s*/, '');
    console.log(demo.name, JSON.stringify(demo.summary));
  }
  fs.writeFileSync(filename, JSON.stringify(demos, null, 2) + '\n');
  const modulePath = path.join(root, 'pal-storage-viewer/src/app/demo-catalog.ts');
  let source = fs.readFileSync(modulePath, 'utf8');
  const start = source.indexOf('export const DEFAULT_DEMO:');
  const end = source.indexOf('\nlet catalog:', start);
  source = source.slice(0, start) + 'export const DEFAULT_DEMO: DemoSave = ' + JSON.stringify(demos.find(d => d.id === 'default'), null, 2) + ';\n' + source.slice(end);
  fs.writeFileSync(modulePath, source);
})().catch(error => { console.error(error); process.exitCode = 1; });
