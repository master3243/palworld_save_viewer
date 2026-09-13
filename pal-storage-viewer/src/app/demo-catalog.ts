import type { DemoSummary } from './demo-summary';

/** Small picker metadata; save bytes are fetched only after a demo is chosen. */
export interface DemoSave {
  id: string;
  name: string;
  author?: string;
  savedAt?: string;
  description: string;
  summary: DemoSummary;
  sourceUrl: string;
  bytes: number;
  files: { url: string; path: string; bytes: number }[];
}

export const DEFAULT_DEMO: DemoSave = {
  "id": "default",
  "name": "Original demo",
  "author": "master3243",
  "savedAt": "2026-09-01",
  "description": "Two snapshots of the same world, including dimensional storage.",
  "sourceUrl": "https://github.com/master3243/palworld_save_viewer/tree/main/resources/example_save",
  "bytes": 4127362,
  "files": [
    {
      "url": "resources/example_save/2026-08-16-00-09/Level.sav",
      "path": "2026-08-16-00-09/Level.sav",
      "bytes": 1536857
    },
    {
      "url": "resources/example_save/2026-08-16-00-09/LevelMeta.sav",
      "path": "2026-08-16-00-09/LevelMeta.sav",
      "bytes": 2018
    },
    {
      "url": "resources/example_save/2026-08-16-00-09/Players/00000000000000000000000000000001.sav",
      "path": "2026-08-16-00-09/Players/00000000000000000000000000000001.sav",
      "bytes": 16063
    },
    {
      "url": "resources/example_save/2026-09-01-21-50/Level.sav",
      "path": "2026-09-01-21-50/Level.sav",
      "bytes": 2350154
    },
    {
      "url": "resources/example_save/2026-09-01-21-50/LevelMeta.sav",
      "path": "2026-09-01-21-50/LevelMeta.sav",
      "bytes": 2018
    },
    {
      "url": "resources/example_save/2026-09-01-21-50/Players/00000000000000000000000000000001.sav",
      "path": "2026-09-01-21-50/Players/00000000000000000000000000000001.sav",
      "bytes": 24807
    },
    {
      "url": "resources/example_save/2026-09-01-21-50/Players/00000000000000000000000000000001_dps.sav",
      "path": "2026-09-01-21-50/Players/00000000000000000000000000000001_dps.sav",
      "bytes": 195445
    }
  ],
  "summary": {
    "percent": 62.6,
    "pals": 3731,
    "level": 80,
    "day": 667,
    "players": 1
  }
};

let catalog: Promise<DemoSave[]> | undefined;
export function loadDemoCatalog(): Promise<DemoSave[]> {
  return catalog ??= fetch('resources/demo-saves/catalog.json').then(async response => {
    if (!response.ok) throw new Error('Could not load the demo list. Please try again.');
    return await response.json() as DemoSave[];
  }).catch(error => { catalog = undefined; throw error; });
}
