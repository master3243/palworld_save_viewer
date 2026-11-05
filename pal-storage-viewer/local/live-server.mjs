#!/usr/bin/env node
/**
 * Live mode helper for the Palworld Save Analyzer.
 *
 * Runs on the PC that has the game. It serves the app and a read-only view of one
 * world's save folder from the same localhost origin, so the browser tab can keep
 * re-reading the saves (a web page cannot watch a folder on its own).
 *
 *   node live-server.mjs [world folder] [--port 8765] [--app <url or built app folder>] [--open]
 *
 * Without a folder it picks the most recently saved Steam world under
 * %LOCALAPPDATA%\Pal\Saved\SaveGames and switches automatically when another world saves.
 * No dependencies; needs Node 18 or newer. Only listens on 127.0.0.1 and never writes.
 */
import { createServer } from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';

const DEFAULT_APP = 'https://master3243.github.io/palworld_save_viewer/';
const WORLD_FILES = ['Level.sav', 'LevelMeta.sav', 'LocalData.sav'];
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.webp': 'image/webp', '.wasm': 'application/wasm', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};

function parseArgs(argv) {
  const options = { port: 8765, app: DEFAULT_APP, folder: '' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--port') options.port = Number(argv[++i]);
    else if (arg === '--app') options.app = argv[++i];
    else if (arg === '--open') options.open = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else options.folder = arg;
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
if (options.help || !Number.isInteger(options.port)) {
  console.log('Usage: node live-server.mjs [world folder] [--port 8765] [--app <url or built app folder>] [--open]');
  process.exit(options.help ? 0 : 1);
}

function savesRoot() {
  const local = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local');
  return join(local, 'Pal', 'Saved', 'SaveGames');
}

/** Newest world folder (<steam id>/<world id>/Level.sav) under the Steam save root. */
async function newestWorld() {
  const root = savesRoot();
  let best = null;
  for (const profile of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!profile.isDirectory()) continue;
    for (const world of await readdir(join(root, profile.name), { withFileTypes: true }).catch(() => [])) {
      if (!world.isDirectory()) continue;
      const folder = join(root, profile.name, world.name);
      const level = await stat(join(folder, 'Level.sav')).catch(() => null);
      if (level && (!best || level.mtimeMs > best.mtime)) best = { folder, mtime: level.mtimeMs };
    }
  }
  return best?.folder ?? '';
}

async function currentFolder() {
  return options.folder ? resolve(options.folder) : newestWorld();
}

/** The save files the app reads, relative to the world folder. */
async function listFiles(folder) {
  const files = [];
  const add = async (path) => {
    const info = await stat(join(folder, path)).catch(() => null);
    if (info?.isFile()) files.push({ path, size: info.size, mtime: Math.round(info.mtimeMs) });
  };
  for (const name of WORLD_FILES) await add(name);
  for (const entry of await readdir(join(folder, 'Players'), { withFileTypes: true }).catch(() => [])) {
    if (entry.isFile() && /\.sav$/i.test(entry.name)) await add(`Players/${entry.name}`);
  }
  return files;
}

/** Only the files listed above can be read; anything else (or ../) is refused. */
function allowedPath(path) {
  return WORLD_FILES.includes(path) || /^Players\/[0-9A-Za-z_]+\.sav$/.test(path);
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

async function handleLive(req, res, url) {
  const folder = await currentFolder();
  if (url.pathname === '/__live/status') {
    const files = folder ? await listFiles(folder) : [];
    const error = !folder ? `No world found. Pass the world folder: node live-server.mjs "<folder>"`
      : !files.some(f => f.path === 'Level.sav') ? `No Level.sav in ${folder}` : '';
    return send(res, 200, JSON.stringify({ folder, files, error }), { 'Content-Type': 'application/json' });
  }
  if (url.pathname === '/__live/file') {
    const path = url.searchParams.get('path') ?? '';
    if (!folder || !allowedPath(path)) return send(res, 404, 'Not found');
    try {
      const full = join(folder, ...path.split('/'));
      const info = await stat(full);
      const bytes = await readFile(full);
      return send(res, 200, bytes, { 'Content-Type': 'application/octet-stream', 'X-Mtime': String(Math.round(info.mtimeMs)) });
    } catch {
      return send(res, 404, 'Not found');
    }
  }
  return send(res, 404, 'Not found');
}

const appIsUrl = /^https?:\/\//i.test(options.app);
const appBase = appIsUrl ? new URL(options.app.endsWith('/') ? options.app : options.app + '/') : null;
const appDir = appIsUrl ? '' : resolve(options.app);
if (!appIsUrl && !existsSync(join(appDir, 'index.html'))) {
  console.error(`No index.html in ${appDir}. Build the app (npm run build) and pass dist/pal-storage-viewer/browser.`);
  process.exit(1);
}

/** The app is relative-path only (<base href="./">), so it works from this server's root. */
async function handleApp(req, res, url) {
  if (url.pathname === '/' && !url.searchParams.has('live')) {
    return send(res, 302, '', { Location: '/?live#tracker' });
  }
  const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
  if (appBase) {
    try {
      const upstream = await fetch(new URL(relative + (relative === 'index.html' ? '' : url.search), appBase));
      const body = Buffer.from(await upstream.arrayBuffer());
      const type = upstream.headers.get('content-type') ?? MIME[extname(relative)] ?? 'application/octet-stream';
      return send(res, upstream.status, body, { 'Content-Type': type });
    } catch (error) {
      return send(res, 502, `Could not reach ${appBase}: ${error.message}`);
    }
  }
  const full = resolve(appDir, relative);
  if (full !== appDir && !full.startsWith(appDir + sep)) return send(res, 404, 'Not found');
  const target = existsSync(full) && statSync(full).isFile() ? full : join(appDir, 'index.html');
  return send(res, 200, await readFile(target), { 'Content-Type': MIME[extname(target)] ?? 'application/octet-stream' });
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Read only');
  const handler = url.pathname.startsWith('/__live/') ? handleLive : handleApp;
  handler(req, res, url).catch(error => send(res, 500, String(error?.message ?? error)));
});

/** Open the page in the default browser (--open, used by the double-click launcher). */
function openBrowser(url) {
  const [command, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(command, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
}

server.on('error', (error) => {
  if (error.code !== 'EADDRINUSE') throw error;
  // Most likely the helper is already running (launcher double-clicked twice): just show the page.
  console.log(`Port ${options.port} is already in use, probably by live mode that is already running.`);
  console.log(`Open http://127.0.0.1:${options.port}/ or pick another port with --port.`);
  if (options.open) openBrowser(`http://127.0.0.1:${options.port}/`);
  process.exitCode = 1;
});

server.listen(options.port, '127.0.0.1', async () => {
  const folder = await currentFolder();
  console.log(`Live mode: open http://127.0.0.1:${options.port}/`);
  console.log(`App:   ${appBase ?? appDir}`);
  console.log(`Saves: ${options.folder ? folder : `newest world under ${savesRoot()}`}${!options.folder && folder ? `\n       (now ${folder})` : ''}`);
  if (!folder) console.log('       No world found yet. Pass the folder that has Level.sav and Players/.');
  console.log('Keep this window open while you play. Close it to stop.');
  if (options.open) openBrowser(`http://127.0.0.1:${options.port}/`);
});
