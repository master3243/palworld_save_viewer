/// <reference lib="webworker" />

/**
 * Runs the Oodle decoder and the Pyodide-hosted Python parser off the main
 * thread, so big saves never freeze the page, and reports real progress.
 */

export interface WorkerFile {
  file: File;
  name: string;
  set: string;
}

export interface ParseRequest {
  type: 'parse';
  id: number;
  files: WorkerFile[];
}

/** Sent on page load so the runtime is ready before the first file arrives. */
export interface InitRequest {
  type: 'init';
}

export interface ProgressMessage {
  type: 'progress';
  id: number;
  /** 0..1 overall, or null while the runtime downloads (no progress events available). */
  fraction: number | null;
  label: string;
  detail: string;
}

export interface ResultMessage {
  type: 'result';
  id: number;
  /** UTF-8 JSON, transferred rather than copied. */
  bytes: Uint8Array;
  /** Wall-clock stamps (ms since epoch) so the main thread can attribute the wait. */
  timing: { pyStart: number; pyDone: number; posted: number };
}

export interface ErrorMessage {
  type: 'error';
  id: number;
  message: string;
}

export type WorkerResponse = ProgressMessage | ResultMessage | ErrorMessage;

type OozModule = { decompress(data: Uint8Array, rawSize: number): Uint8Array };

type PyBytesProxy = { toJs(): Uint8Array; destroy(): void };

type PyodideRuntime = {
  FS: {
    mkdirTree(path: string): void;
    writeFile(path: string, data: string | Uint8Array): void;
    unlink(path: string): void;
  };
  globals: { set(name: string, value: unknown): void; delete(name: string): void };
  runPythonAsync<T = unknown>(code: string): Promise<T>;
};

const PYODIDE_VERSION = '0.26.4';
const PYODIDE_BASE = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
/** The worker chunk is emitted next to index.html, so this is the app base URL. */
const APP_BASE = new URL('./', self.location.href);

/** Share of the bar given to each stage; the runtime download has no events. */
const READ_SHARE = 0.1;
const PARSE_SHARE = 0.85;

const scope = self as unknown as DedicatedWorkerGlobalScope;
let pyodidePromise: Promise<PyodideRuntime> | undefined;
let oozPromise: Promise<OozModule> | undefined;

/** Decoded byte size of every file already parsed and cached inside Python, by file key. */
const parsedWeights = new Map<string, number>();

scope.addEventListener('message', (event: MessageEvent<ParseRequest | InitRequest>) => {
  const request = event.data;
  if (request?.type === 'init') {
    void Promise.all([getPyodide(), getOoz()]).catch(() => { /* reported on first parse */ });
    return;
  }
  if (request?.type !== 'parse') return;
  void handleParse(request).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    post({ type: 'error', id: request.id, message });
  });
});

/** Stable identity for a picked file; the same file picked again hits the parse cache. */
function fileKey(entry: WorkerFile): string {
  return `${entry.set}|${entry.name}|${entry.file.size}|${entry.file.lastModified}`;
}

function post(message: WorkerResponse): void {
  scope.postMessage(message);
}

async function handleParse(request: ParseRequest): Promise<void> {
  const { id, files } = request;
  const progress = (fraction: number | null, label: string, detail = '') =>
    post({ type: 'progress', id, fraction, label, detail });

  const runtimeReady = Boolean(pyodidePromise && oozPromise);
  if (!runtimeReady) progress(null, 'Initializing\u2026', '');
  const [pyodide, ooz] = await Promise.all([getPyodide(), getOoz()]);
  pyodide.FS.mkdirTree('/app/input');

  // Stage 1: read + decompress every file that Python has not already parsed.
  const manifest: { key: string; path: string; name: string; set: string }[] = [];
  const weights: number[] = [];
  const written: string[] = [];
  const keys = files.map(fileKey);
  for (const [index, entry] of files.entries()) {
    const key = keys[index];
    const cachedWeight = parsedWeights.get(key);
    if (cachedWeight !== undefined) {
      manifest.push({ key, path: '', name: entry.name, set: entry.set });
      weights.push(cachedWeight);
      continue;
    }
    progress((index / files.length) * READ_SHARE, 'Decompressing', `${entry.name} (${index + 1} of ${files.length})`);
    const bytes = new Uint8Array(await entry.file.arrayBuffer());
    const decoded = decodeSave(bytes, ooz);
    const path = `/app/input/${index}_${entry.name.replace(/[^A-Za-z0-9._-]/g, '_')}`;
    pyodide.FS.writeFile(path, decoded);
    written.push(path);
    manifest.push({ key, path, name: entry.name, set: entry.set });
    weights.push(decoded.byteLength);
  }
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || 1;

  // Stage 2: parse in Python, which calls back with per-file record counts.
  const fileFractions = files.map(() => 0);
  const onProgress = (stage: string, fileIndex: number, done: number, total: number, found: number, unit: string) => {
    if (stage === 'combine') {
      fileFractions.fill(1);
      progress(READ_SHARE + PARSE_SHARE, 'Resolving locations', '');
      return;
    }
    if (stage === 'flatten') {
      const share = total > 0 ? done / total : 1;
      progress(READ_SHARE + PARSE_SHARE + share * (1 - READ_SHARE - PARSE_SHARE), 'Formatting results', `${done.toLocaleString()} of ${total.toLocaleString()} pals`);
      return;
    }
    for (let index = 0; index < fileIndex; index++) fileFractions[index] = 1;
    if (fileIndex < fileFractions.length) {
      fileFractions[fileIndex] = stage === 'done' ? 1 : total > 0 ? done / total : 0;
    }
    const weighted = fileFractions.reduce((sum, fraction, index) => sum + fraction * weights[index], 0) / totalWeight;
    const name = files[fileIndex]?.name ?? '';
    let detail = name;
    if (stage === 'parse' && total > 0) {
      const pals = `${found.toLocaleString()} pal${found === 1 ? '' : 's'}`;
      detail = unit === 'entries'
        ? `${name}: ${done.toLocaleString()} of ${total.toLocaleString()} entries, ${pals}`
        : `${name}: ${done.toLocaleString()} of ${total.toLocaleString()} pals`;
    }
    progress(READ_SHARE + weighted * PARSE_SHARE, 'Reading pals', detail);
  };
  pyodide.globals.set('progress_cb', onProgress);

  let bytes: Uint8Array;
  const pyStart = Date.now();
  try {
    const proxy = await pyodide.runPythonAsync<PyBytesProxy>(`
import importlib
import sys
sys.path.insert(0, '/app')
main = importlib.import_module('main')
main.combine_decoded_saves_to_json_bytes(${JSON.stringify(JSON.stringify(manifest))}, '/app/resources', progress=progress_cb)
`);
    bytes = proxy.toJs();
    proxy.destroy();
  } finally {
    pyodide.globals.delete('progress_cb');
    for (const path of written) {
      try { pyodide.FS.unlink(path); } catch { /* already gone */ }
    }
  }
  // Python now caches these; mirror the set so the next request skips them.
  parsedWeights.clear();
  keys.forEach((key, index) => parsedWeights.set(key, weights[index]));
  const pyDone = Date.now();
  progress(1, 'Building table', '');
  const message: ResultMessage = { type: 'result', id, bytes, timing: { pyStart, pyDone, posted: Date.now() } };
  scope.postMessage(message, [bytes.buffer]);
}

function decodeSave(bytes: Uint8Array, ooz: OozModule): Uint8Array {
  if (startsWith(bytes, [0x47, 0x56, 0x41, 0x53])) {
    return bytes;
  }
  if (!startsWith(bytes.subarray(8, 12), [0x50, 0x6c, 0x4d, 0x31])) {
    throw new Error('This does not look like a Palworld PlM1/GVAS save file.');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const uncompressedLength = view.getUint32(0, true);
  const compressedLength = view.getUint32(4, true);
  const decoded = new Uint8Array(ooz.decompress(bytes.subarray(12, 12 + compressedLength), uncompressedLength));
  if (!startsWith(decoded, [0x47, 0x56, 0x41, 0x53])) {
    throw new Error('The save decoded, but the result was not a GVAS payload.');
  }
  return decoded;
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte);
}

function getOoz(): Promise<OozModule> {
  const decoderUrl = new URL('resources/browser/ooz-index.js', APP_BASE).toString();
  oozPromise ??= import(/* @vite-ignore */ decoderUrl) as Promise<OozModule>;
  return oozPromise;
}

function getPyodide(): Promise<PyodideRuntime> {
  pyodidePromise ??= (async () => {
    const loaderUrl = `${PYODIDE_BASE}pyodide.mjs`;
    const module = await import(/* @vite-ignore */ loaderUrl) as {
      loadPyodide(config: { indexURL: string }): Promise<PyodideRuntime>;
    };
    const pyodide = await module.loadPyodide({ indexURL: PYODIDE_BASE });
    pyodide.FS.mkdirTree('/app/resources');
    await Promise.all([
      writeTextFile(pyodide, '/app/main.py', 'python/main.py'),
      writeTextFile(pyodide, '/app/data_manager.py', 'python/data_manager.py'),
      writeTextFile(pyodide, '/app/resources/active_skills_lookup.json', 'resources/active_skills_lookup.json'),
      writeTextFile(pyodide, '/app/resources/passive_skills_lookup.json', 'resources/passive_skills_lookup.json'),
      writeTextFile(pyodide, '/app/resources/passive_ranks_lookup.lua', 'resources/passive_ranks_lookup.lua'),
      writeTextFile(pyodide, '/app/resources/pal_names_lookup.lua', 'resources/pal_names_lookup.lua')
    ]);
    return pyodide;
  })();
  return pyodidePromise;
}

async function writeTextFile(pyodide: PyodideRuntime, path: string, relativeUrl: string): Promise<void> {
  const response = await fetch(new URL(relativeUrl, APP_BASE));
  if (!response.ok) throw new Error(`Could not load ${relativeUrl} (${response.status}).`);
  pyodide.FS.writeFile(path, await response.text());
}
