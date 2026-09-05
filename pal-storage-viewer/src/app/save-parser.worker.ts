/// <reference lib="webworker" />

/**
 * Runs the Oodle decoder and the save backend off the main thread so big saves never
 * freeze the page, reports real progress, and caches parsed files so adding or
 * removing one file does not re-parse the others.
 */
import {
  CombineEntry, CombinedSaves, Lookups, ParsedFile, combineSaves, decodeSave, palCount, parseSaveFile
} from '../backend';

export interface WorkerFile {
  file: File;
  name: string;
  set: string;
  /** Letter the page assigned to this save; stays stable across reloads. */
  letter: string;
}

export interface ParseRequest {
  type: 'parse';
  id: number;
  files: WorkerFile[];
}

/** Sent on page load so the decoder and lookups are ready before the first file arrives. */
export interface InitRequest {
  type: 'init';
}

/** Pal counts for a confirmation preview; parses (and caches) the files. */
export interface CountRequest {
  type: 'count';
  id: number;
  files: { file: File; name: string; set: string }[];
}

export interface ProgressMessage {
  type: 'progress';
  id: number;
  /** 0..1 overall, or null while something with no progress events runs. */
  fraction: number | null;
  label: string;
  detail: string;
}

export interface ResultMessage {
  type: 'result';
  id: number;
  data: CombinedSaves;
}

export interface ErrorMessage {
  type: 'error';
  id: number;
  message: string;
}

export interface CountMessage {
  type: 'count';
  id: number;
  index: number;
  kind: string;
  pals: number | null;
}

export interface CountDoneMessage {
  type: 'count-done';
  id: number;
}

export type WorkerResponse = ProgressMessage | ResultMessage | ErrorMessage | CountMessage | CountDoneMessage;

type OozModule = { decompress(data: Uint8Array, rawSize: number): Uint8Array };

/** The worker chunk is emitted next to index.html, so this is the app base URL. */
const APP_BASE = new URL('./', self.location.href);

/** Share of the bar given to each stage. */
const READ_SHARE = 0.1;
const PARSE_SHARE = 0.85;

/** Parsed files kept after they are removed, so re-adding one is instant. */
const STALE_CACHE_LIMIT = 6;

const scope = self as unknown as DedicatedWorkerGlobalScope;
let oozPromise: Promise<OozModule> | undefined;
let lookupsPromise: Promise<Lookups> | undefined;
const parsedCache = new Map<string, ParsedFile | { error: string }>();

scope.addEventListener('message', (event: MessageEvent<ParseRequest | InitRequest | CountRequest>) => {
  const request = event.data;
  if (request?.type === 'init') {
    void Promise.all([getOoz(), getLookups()]).catch(() => { /* reported on first parse */ });
    return;
  }
  if (request?.type === 'count') {
    void handleCount(request).catch(() => post({ type: 'count-done', id: request.id }));
    return;
  }
  if (request?.type !== 'parse') return;
  void handleParse(request).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    post({ type: 'error', id: request.id, message });
  });
});

function post(message: WorkerResponse): void {
  scope.postMessage(message);
}

/** Stable identity for a picked file; the same file picked again hits the cache. */
function fileKey(set: string, file: File): string {
  return `${set}|${file.name}|${file.size}|${file.lastModified}`;
}

async function parseInto(
  key: string,
  file: File,
  progress?: (done: number, total: number, found: number, unit: string) => void
): Promise<ParsedFile | { error: string }> {
  const cached = parsedCache.get(key);
  if (cached) return cached;
  const [ooz, lookups] = await Promise.all([getOoz(), getLookups()]);
  let parsed: ParsedFile | { error: string };
  try {
    const decoded = decodeSave(new Uint8Array(await file.arrayBuffer()), ooz);
    parsed = parseSaveFile(decoded, lookups, progress);
  } catch (error) {
    parsed = { error: error instanceof Error ? error.message : String(error) };
  }
  parsedCache.set(key, parsed);
  return parsed;
}

async function handleParse(request: ParseRequest): Promise<void> {
  const { id, files } = request;
  const progress = (fraction: number | null, label: string, detail = '') =>
    post({ type: 'progress', id, fraction, label, detail });

  if (!(oozPromise && lookupsPromise)) progress(null, 'Initializing…', '');
  await Promise.all([getOoz(), getLookups()]);

  const weights = files.map((entry) => entry.file.size || 1);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  const fileFractions = files.map(() => 0);
  const report = (label: string, detail: string) => {
    const weighted = fileFractions.reduce((sum, fraction, i) => sum + fraction * weights[i], 0) / totalWeight;
    progress(READ_SHARE + weighted * PARSE_SHARE, label, detail);
  };

  const entries: CombineEntry[] = [];
  for (const [index, entry] of files.entries()) {
    const key = fileKey(entry.set, entry.file);
    if (!parsedCache.has(key)) {
      progress(READ_SHARE * (index / files.length), 'Decompressing', `${entry.name} (${index + 1} of ${files.length})`);
    }
    const parsed = await parseInto(key, entry.file, (done, total, found, unit) => {
      fileFractions[index] = total > 0 ? done / total : 0;
      const pals = `${found.toLocaleString()} pal${found === 1 ? '' : 's'}`;
      const detail = unit === 'entries'
        ? `${entry.name}: ${done.toLocaleString()} of ${total.toLocaleString()} entries, ${pals}`
        : `${entry.name}: ${done.toLocaleString()} of ${total.toLocaleString()} pals`;
      report('Reading pals', detail);
    });
    fileFractions[index] = 1;
    entries.push({ key, name: entry.name, set: entry.set, letter: entry.letter, parsed });
  }

  progress(READ_SHARE + PARSE_SHARE, 'Resolving locations', '');
  const data = combineSaves(entries);

  // Keep a few recently removed files so re-adding them is instant, but bound memory.
  const live = new Set(entries.map((entry) => entry.key));
  const stale = [...parsedCache.keys()].filter((key) => !live.has(key));
  for (const key of stale.slice(0, Math.max(0, stale.length - STALE_CACHE_LIMIT))) parsedCache.delete(key);

  progress(1, 'Building table', '');
  post({ type: 'result', id, data });
}

async function handleCount(request: CountRequest): Promise<void> {
  for (const [index, entry] of request.files.entries()) {
    // Same cache key the parse will use, so the preview does the real work up front.
    const parsed = await parseInto(fileKey(entry.set, entry.file), entry.file);
    post({
      type: 'count',
      id: request.id,
      index,
      kind: 'error' in parsed ? 'unknown' : parsed.kind,
      pals: 'error' in parsed ? null : palCount(parsed),
    });
  }
  post({ type: 'count-done', id: request.id });
}

function getOoz(): Promise<OozModule> {
  const decoderUrl = new URL('resources/browser/ooz-index.js', APP_BASE).toString();
  oozPromise ??= import(/* @vite-ignore */ decoderUrl) as Promise<OozModule>;
  return oozPromise;
}

function getLookups(): Promise<Lookups> {
  lookupsPromise ??= (async () => {
    const [activeSkillsJson, passiveSkillsJson, passiveRanksLua, palNamesLua] = await Promise.all([
      loadText('resources/active_skills_lookup.json'),
      loadText('resources/passive_skills_lookup.json'),
      loadText('resources/passive_ranks_lookup.lua'),
      loadText('resources/pal_names_lookup.lua'),
    ]);
    return new Lookups({ activeSkillsJson, passiveSkillsJson, passiveRanksLua, palNamesLua });
  })();
  return lookupsPromise;
}

async function loadText(relativeUrl: string): Promise<string> {
  const response = await fetch(new URL(relativeUrl, APP_BASE));
  if (!response.ok) throw new Error(`Could not load ${relativeUrl} (${response.status}).`);
  return response.text();
}

