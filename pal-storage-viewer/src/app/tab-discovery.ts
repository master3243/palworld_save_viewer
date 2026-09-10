export type ViewMode = 'pals' | 'tracker';
type VisitStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
// Ignore older flags, which also counted visits made before loading a save.
const STORAGE_KEY = 'pal-viewer.visited-loaded-tabs';

function browserStorage(): VisitStorage | null {
  try { return localStorage; } catch { return null; }
}

/** Remember discovered tabs, with an in-memory fallback when storage is unavailable. */
export class TabDiscovery {
  private readonly visited = new Set<ViewMode>();

  constructor(private readonly storage = browserStorage()) {
    try { storage?.removeItem('pal-viewer.visited-tabs'); } catch { /* Storage may be read-only. */ }
    try {
      const saved: unknown = JSON.parse(storage?.getItem(STORAGE_KEY) ?? '[]');
      if (Array.isArray(saved)) {
        for (const view of saved) if (view === 'pals' || view === 'tracker') this.visited.add(view);
      }
    } catch { /* A missing or invalid preference should not block the viewer. */ }
  }

  visit(view: ViewMode, loaded: boolean): void {
    if (!loaded) return;
    this.visited.add(view);
    try { this.storage?.setItem(STORAGE_KEY, JSON.stringify([...this.visited])); } catch { /* Keep the in-memory preference. */ }
  }

  shouldPing(view: ViewMode, active: ViewMode, loaded: boolean): boolean {
    return loaded && view !== active && !this.visited.has(view);
  }
}
