/**
 * Browser half of live mode (see local/README.md). Only active when the page URL has
 * `?live`, which local/live-server.mjs adds. It polls the helper for the save folder,
 * loads the saves once, then keeps every player's map position current from their small
 * Players/<uid>.sav, and offers a reload when the world files change.
 */
import { decodeSave, type OodleDecoder } from '../src/backend/decode';
import { SaveBuffer, findPropertyStart, readStructPayload, readVector } from '../src/backend/gvas';
import type { SaveInput } from '../src/backend/wgs';

export interface LivePlayer {
  uid: string;
  /** Unreal world units, as stored in the save. */
  x: number; y: number; z: number;
  /** Facing in radians, clockwise from map north. */
  heading: number;
  /** When the game last wrote this position (ms since epoch). */
  savedAt: number;
}

interface LiveFile { path: string; size: number; mtime: number }
interface LiveStatus { folder: string; files: LiveFile[]; error: string }

const POLL_MS = 2000;
const listeners = new Set<(players: LivePlayer[]) => void>();
let players: LivePlayer[] = [];

export function liveModeEnabled(): boolean {
  return new URLSearchParams(location.search).has('live');
}

/** Subscribe to position updates; called immediately with the current list. */
export function onLivePlayers(listener: (players: LivePlayer[]) => void): () => void {
  listeners.add(listener);
  listener(players);
  return () => listeners.delete(listener);
}

function publish(next: LivePlayer[]): void {
  players = next;
  for (const listener of listeners) listener(players);
}

const versionOf = (file: LiveFile) => `${file.size}:${file.mtime}`;
const isPlayerSave = (path: string) => /^Players\/[0-9A-Za-z]+\.sav$/i.test(path) && !/_dps\.sav$/i.test(path);

/**
 * Start polling. `load` replaces the loaded saves; it is called once at start and again
 * whenever the user clicks Reload after the world files changed.
 */
export function startLiveLink(load: (inputs: SaveInput[]) => Promise<void>): void {
  const widget = new LiveWidget();
  let previous = new Map<string, string>();
  let loadedFolder = '';
  let loadedVersions = new Map<string, string>();
  const positionVersions = new Map<string, string>();
  let busy = false;
  let lastStatus: LiveStatus | null = null;

  const settledFiles = (status: LiveStatus) =>
    // A file counts once two polls in a row see the same size and time, so half-written saves are skipped.
    status.files.filter(file => previous.get(file.path) === versionOf(file));

  const reload = async () => {
    if (busy || !lastStatus) return;
    busy = true;
    widget.update({ text: 'Loading saves...', stale: false });
    try {
      const status = lastStatus;
      const files = settledFiles(status);
      const inputs = await Promise.all(files.map(async (file): Promise<SaveInput> => {
        const bytes = await fetchFile(file.path);
        const name = file.path.split('/').pop()!;
        return { file: new File([bytes], name, { lastModified: file.mtime }), path: file.path };
      }));
      await load(inputs);
      loadedFolder = status.folder;
      loadedVersions = new Map(files.filter(f => !isPlayerSave(f.path)).map(f => [f.path, versionOf(f)]));
      widget.update({ text: '', stale: false, error: '' });
    } catch (error) {
      widget.update({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      busy = false;
    }
  };
  widget.onReload = () => void reload();

  const tick = async () => {
    let status: LiveStatus;
    try {
      const response = await fetch('/__live/status', { cache: 'no-store' });
      if (!response.ok) throw new Error(`helper answered ${response.status}`);
      status = await response.json() as LiveStatus;
    } catch {
      widget.update({ error: 'Live helper not running. Start local/live-server.mjs and open the link it prints.' });
      return;
    }
    if (status.error) { widget.update({ error: status.error }); previous = new Map(); return; }
    const settled = settledFiles(status);
    previous = new Map(status.files.map(file => [file.path, versionOf(file)]));
    lastStatus = status;
    if (!settled.some(f => f.path === 'Level.sav')) return;

    if (!loadedFolder && !busy) await reload();

    for (const file of settled.filter(f => isPlayerSave(f.path))) {
      if (positionVersions.get(file.path) === versionOf(file)) continue;
      try {
        const position = await readPlayerPosition(file);
        positionVersions.set(file.path, versionOf(file));
        if (position) publish([...players.filter(p => p.uid !== position.uid), position]);
      } catch { /* mid-write or unreadable; retried on the next change */ }
    }

    const worldChanged = status.folder !== loadedFolder || settled.some(f =>
      !isPlayerSave(f.path) && loadedVersions.get(f.path) !== versionOf(f));
    const newest = Math.max(0, ...players.map(p => p.savedAt));
    if (!busy) widget.update({ newest, stale: !!loadedFolder && worldChanged, error: '' });
  };

  const loop = async () => {
    await tick().catch(() => {});
    setTimeout(loop, POLL_MS);
  };
  void loop();
}

async function fetchFile(path: string): Promise<ArrayBuffer> {
  const response = await fetch(`/__live/file?path=${encodeURIComponent(path)}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Could not read ${path} (${response.status}).`);
  return response.arrayBuffer();
}

let oozPromise: Promise<OodleDecoder> | undefined;
function ooz(): Promise<OodleDecoder> {
  oozPromise ??= import(/* @vite-ignore */ new URL('resources/browser/ooz-index.js', document.baseURI).toString());
  return oozPromise;
}

async function readPlayerPosition(file: LiveFile): Promise<LivePlayer | null> {
  const bytes = decodeSave(new Uint8Array(await fetchFile(file.path)), await ooz());
  const buf = new SaveBuffer(bytes);
  const transform = readStructPayload(buf, findPropertyStart(buf, 'LastTransform'), 'Transform');
  if (!transform) return null;
  const point = readVector(buf, findPropertyStart(buf, 'Translation', transform.start, transform.end));
  if (!point) return null;
  let heading = 0;
  const rotation = readStructPayload(buf, findPropertyStart(buf, 'Rotation', transform.start, transform.end), 'Quat');
  if (rotation && rotation.end - rotation.start >= 32) {
    const [x, y, z, w] = [0, 8, 16, 24].map(offset => buf.f64(rotation.start + offset));
    // Unreal yaw is measured from +X (map north) toward +Y (map east), i.e. clockwise on the map.
    heading = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
  }
  const uid = file.path.split('/').pop()!.replace(/\.sav$/i, '');
  return { uid, ...point, heading, savedAt: file.mtime };
}

/** Small status pill in the corner; plain DOM so the app templates stay untouched. */
class LiveWidget {
  onReload: () => void = () => {};
  private readonly root = document.createElement('div');
  private readonly label = document.createElement('span');
  private readonly button = document.createElement('button');
  private state = { text: 'Connecting to live helper...', error: '', stale: false, newest: 0 };

  constructor() {
    this.root.setAttribute('role', 'status');
    Object.assign(this.root.style, {
      position: 'fixed', right: '12px', bottom: '12px', zIndex: '1000', display: 'flex', gap: '8px', alignItems: 'center',
      padding: '6px 10px', borderRadius: '999px', background: '#0b1a22ee', color: '#d8eef5', border: '1px solid #2f5566',
      font: '500 12px system-ui, sans-serif', boxShadow: '0 2px 10px #0008',
    });
    this.button.type = 'button';
    this.button.textContent = 'Reload saves';
    Object.assign(this.button.style, {
      font: 'inherit', padding: '2px 8px', borderRadius: '999px', border: '1px solid #6ee3ff', background: '#123544',
      color: '#e6fbff', cursor: 'pointer', display: 'none',
    });
    this.button.addEventListener('click', () => this.onReload());
    this.root.append(this.label, this.button);
    document.body.append(this.root);
    setInterval(() => this.render(), 1000);
    this.render();
  }

  update(change: Partial<LiveWidget['state']>): void {
    this.state = { ...this.state, ...change, text: change.text ?? (change.newest !== undefined ? '' : this.state.text) };
    this.render();
  }

  private render(): void {
    const { text, error, stale, newest } = this.state;
    const age = newest ? Math.max(0, Math.round((Date.now() - newest) / 1000)) : null;
    const ageText = age === null ? 'waiting for a player save' : age < 90 ? `${age}s ago` : `${Math.round(age / 60)} min ago`;
    this.label.textContent = error ? `● Live: ${error}` : text || `● Live · position saved ${ageText}`;
    this.label.style.color = error ? '#ffb4a8' : '#9ff5c4';
    this.button.style.display = stale && !error ? '' : 'none';
    this.button.title = 'The game saved new world data. Reload to refresh the tracker and Pal list.';
  }
}
