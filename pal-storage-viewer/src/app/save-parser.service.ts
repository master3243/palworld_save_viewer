import { Injectable } from '@angular/core';

export type PalStorageRow = Record<string, unknown>;

/** One save file chosen by the user, with the folder path it was picked from (if any). */
export interface SaveInput {
  file: File;
  /** Relative path inside a dropped/picked folder, e.g. "MyWorld/Players/x_dps.sav". */
  path: string;
}

export interface SaveSource {
  file: string;
  set: string;
  kind: string;
  kind_label: string;
  pals: number;
  note: string;
  players?: number;
  bases?: number;
  total_slots?: number;
  world_name?: string;
  host_player_name?: string;
  saved_at?: string;
  skipped?: { players: number; wild_or_npc: number; unreadable: number };
}

export interface SaveSetSummary {
  label: string;
  letter: string;
  folder: string;
  world_name: string;
  host_player_name: string;
  in_game_day: number | null;
  saved_at: string;
  pals: number;
  bases: { index: number; location: { x: number; y: number; z: number } | null; workers: number }[];
  players: { uid: string; name: string }[];
  has_level: boolean;
  has_dimensional_storage: boolean;
}

export interface CombinedSaves {
  rows: PalStorageRow[];
  sources: SaveSource[];
  sets: SaveSetSummary[];
}

/** Files in a save folder that never contain pals; skipped before decoding. */
const IGNORED_FILE_NAMES = new Set(['localdata.sav', 'worldoption.sav']);

export interface ParseProgress {
  /** 0..1, or null while something with no progress events runs (runtime download). */
  fraction: number | null;
  label: string;
  detail: string;
}

type WorkerResponse =
  | { type: 'progress'; id: number; fraction: number | null; label: string; detail: string }
  | { type: 'result'; id: number; bytes: Uint8Array; timing: { pyStart: number; pyDone: number; posted: number } }
  | { type: 'error'; id: number; message: string }
  | { type: 'count'; id: number; index: number; kind: string; pals: number | null }
  | { type: 'count-done'; id: number };

@Injectable({ providedIn: 'root' })
export class SaveParserService {
  private worker?: Worker;
  private nextRequestId = 1;
  private readonly pending = new Map<number, {
    resolve: (json: string) => void;
    reject: (error: Error) => void;
    onProgress?: (progress: ParseProgress) => void;
  }>();
  /** Durations of the last parse, in ms, for debugging slow loads. */
  lastTiming: Record<string, number> = {};
  private readonly pendingCounts = new Map<number, {
    onEach: (index: number, kind: string, pals: number | null) => void;
    resolve: () => void;
  }>();

  /**
   * Preview how many pals each file holds. Runs in the worker (decompress + byte
   * scan, about a tenth of the full parse) and reports per file as it goes.
   */
  countPals(inputs: SaveInput[], onEach: (index: number, kind: string, pals: number | null) => void): Promise<void> {
    if (!inputs.length) return Promise.resolve();
    const worker = this.getWorker();
    const id = this.nextRequestId++;
    return new Promise<void>((resolve) => {
      this.pendingCounts.set(id, { onEach, resolve });
      worker.postMessage({ type: 'count', id, files: inputs.map((input) => ({ file: input.file, name: input.file.name })) });
    });
  }

  async parse(file: File): Promise<PalStorageRow[]> {
    return (await this.parseMany([{ file, path: file.name }])).rows;
  }

  /** Start the worker and its Python runtime now, so the first load skips that wait. */
  warmUp(): void {
    try {
      this.getWorker().postMessage({ type: 'init' });
    } catch {
      // No worker support; the error surfaces when a file is loaded.
    }
  }

  /**
   * Decode every given save file and merge them into one pal list. Files that
   * share a top-level folder are treated as one save (so Level.sav, the
   * player save and the dimensional storage file resolve each other's
   * container ids); loose files all go into one default set.
   *
   * All heavy work (Oodle, Pyodide) runs in a Web Worker so the page never
   * freezes; `onProgress` receives real per-file, per-record progress.
   */
  async parseMany(
    inputs: SaveInput[],
    onProgress?: (progress: ParseProgress) => void,
    letters: ReadonlyMap<string, string> = new Map()
  ): Promise<CombinedSaves> {
    const usable = inputs.filter((input) => this.isCandidate(input));
    if (!usable.length) {
      throw new Error('No Palworld save files found. Drop Level.sav, a Players folder, or a _dps.sav file.');
    }
    const files = usable.map((input) => {
      const set = this.setLabel(input);
      return { file: input.file, name: input.file.name, set, letter: letters.get(set) ?? '' };
    });
    let jsonText: string;
    try {
      jsonText = await this.runInWorker(files, onProgress);
    } catch (error) {
      throw new Error(this.formatParseError(error));
    }

    const parseStart = Date.now();
    const result = JSON.parse(jsonText) as CombinedSaves & { timing?: Record<string, number> };
    this.lastTiming['jsonParse'] = Date.now() - parseStart;
    Object.assign(this.lastTiming, result.timing ?? {});
    if (!result.rows.length) {
      const notes = result.sources.map((source) => source.note).filter(Boolean);
      throw new Error(notes[0] || this.wrongSaveMessage());
    }
    return result;
  }

  /** True for files worth decoding: any .sav/.gvas except the known pal-free ones. */
  isCandidate(input: SaveInput): boolean {
    const name = input.file.name.toLowerCase();
    if (IGNORED_FILE_NAMES.has(name)) return false;
    return name.endsWith('.sav') || name.endsWith('.gvas');
  }

  private runInWorker(
    files: { file: File; name: string; set: string; letter: string }[],
    onProgress?: (progress: ParseProgress) => void
  ): Promise<string> {
    const worker = this.getWorker();
    const id = this.nextRequestId++;
    return new Promise<string>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress });
      worker.postMessage({ type: 'parse', id, files });
    });
  }

  private getWorker(): Worker {
    if (this.worker) return this.worker;
    if (typeof Worker === 'undefined') {
      throw new Error('This browser does not support Web Workers.');
    }
    const worker = new Worker(new URL('./save-parser.worker', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (message.type === 'count' || message.type === 'count-done') {
        const counting = this.pendingCounts.get(message.id);
        if (!counting) return;
        if (message.type === 'count') {
          counting.onEach(message.index, message.kind, message.pals);
        } else {
          this.pendingCounts.delete(message.id);
          counting.resolve();
        }
        return;
      }
      const request = this.pending.get(message.id);
      if (!request) return;
      if (message.type === 'progress') {
        request.onProgress?.({ fraction: message.fraction, label: message.label, detail: message.detail });
      } else if (message.type === 'result') {
        this.pending.delete(message.id);
        const received = Date.now();
        const jsonText = new TextDecoder().decode(message.bytes);
        this.lastTiming = {
          python: message.timing.pyDone - message.timing.pyStart,
          transfer: received - message.timing.posted,
          decode: Date.now() - received,
          jsonBytes: message.bytes.byteLength
        };
        request.resolve(jsonText);
      } else {
        this.pending.delete(message.id);
        request.reject(new Error(message.message));
      }
    };
    worker.onerror = (event) => {
      const error = new Error(event.message || 'The save parser worker crashed.');
      for (const request of this.pending.values()) request.reject(error);
      this.pending.clear();
      worker.terminate();
      this.worker = undefined;
    };
    this.worker = worker;
    return worker;
  }

  /**
   * Save set = the folder that holds Level.sav / Players. For "World/Players/x.sav"
   * that is "World"; for "World/Level.sav" also "World"; for a bare file "".
   */
  setLabel(input: SaveInput): string {
    const parts = input.path.split('/').filter(Boolean);
    parts.pop(); // file name
    if (parts.length && parts[parts.length - 1].toLowerCase() === 'players') parts.pop();
    return parts.join('/');
  }

  private formatParseError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes('OverflowError') ||
      message.includes('extract_records') ||
      message.includes('PalIndividualCharacterSaveParameter')
    ) {
      return this.wrongSaveMessage();
    }
    return message.split('\n')[0] || 'Could not load this save file.';
  }

  private wrongSaveMessage(): string {
    return 'No pals found in these files. Use Level.sav and the Players folder from your save, or the _dps.sav dimensional storage file.';
  }
}
