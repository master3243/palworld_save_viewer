export type ViewMode = 'pals' | 'tracker';
type DiscoverableTab = ViewMode | 'map';
type VisitStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
// Ignore older flags, which also counted visits made before loading a save.
const STORAGE_KEY = 'pal-viewer.visited-loaded-tabs';

function browserStorage(): VisitStorage | null {
  try { return localStorage; } catch { return null; }
}

/** Remember discovered tabs, with an in-memory fallback when storage is unavailable. */
export class TabDiscovery {
  private readonly visited = new Set<DiscoverableTab>();

  constructor(private readonly storage = browserStorage()) {
    try { storage?.removeItem('pal-viewer.visited-tabs'); } catch { /* Storage may be read-only. */ }
    this.readVisits();
  }

  private readVisits(): void {
    try {
      const saved: unknown = JSON.parse(this.storage?.getItem(STORAGE_KEY) ?? '[]');
      if (Array.isArray(saved)) {
        for (const view of saved) if (view === 'pals' || view === 'tracker' || view === 'map') this.visited.add(view);
      }
    } catch { /* A missing or invalid preference should not block the viewer. */ }
  }

  visit(view: DiscoverableTab, loaded: boolean): void {
    if (!loaded) return;
    // The main tabs and tracker own separate instances of this preference.
    this.readVisits();
    this.visited.add(view);
    try { this.storage?.setItem(STORAGE_KEY, JSON.stringify([...this.visited])); } catch { /* Keep the in-memory preference. */ }
  }

  shouldPing(view: DiscoverableTab, active: DiscoverableTab | null, loaded: boolean): boolean {
    return loaded && view !== active && !this.visited.has(view);
  }
}
