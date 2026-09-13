import type { Category, ItemState, TrackedItem } from './completion-model';

export interface MapDefinition {
  key: string; name: string; image: string; detail?: string;
  minX: number; maxX: number; minY: number; maxY: number;
}
export interface MapPoint { x: number; y: number }
export interface MapObjective extends MapPoint {
  key: string; map: string; category: string; categoryName: string; item: TrackedItem;
}
export interface MarkerCluster extends MapPoint { items: MapObjective[] }

export const CATEGORY_COLORS: Record<string, string> = {
  relics: '#85efb1', notes: '#ffd779', fastTravel: '#6ee3ff', towers: '#ff897e',
  towersHard: '#ee86c1', alphas: '#edab73', bounties: '#ff778e', mainQuests: '#d8b4ff',
  sideQuests: '#a7a6ff', areas: '#a8d3e8', ruins: '#dfc599',
};
export const CATEGORY_ICONS: Record<string, string> = {
  paldeck: 'Paldeck', captureBonus: 'Capture Bonus', raids: 'Raid Boss', statue: 'Statue of Power',
  technologies: 'Technology', research: 'Lab Research', skins: 'Skins',
  relics: 'Lifmunk Effigy', notes: 'Journals', fastTravel: 'Fast Travel', towers: 'Tower',
  towersHard: 'Tower', alphas: 'Alpha Pal', bounties: 'Bounty', mainQuests: 'Main Mission',
  sideQuests: 'Sub Mission', areas: 'Region', ruins: 'Ancient Ruin',
};
export const STATE_LABELS: Record<ItemState, string> = { done: 'Done', active: 'Missing', todo: 'Missing' };

export function objectiveKey(category: string, id: string): string { return `${category}:${id}`; }

export function parseCoordinates(value: string): MapPoint | null {
  const match = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(value);
  if (!match) return null;
  const x = Number(match[1]), y = Number(match[2]);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

export function mapObjectives(categories: Category[]): MapObjective[] {
  return categories.filter(c => !c.needsFile).flatMap(category => category.items.flatMap(item => {
    const point = item.position ?? parseCoordinates(item.coords);
    if (!point || item.counted === false) return [];
    return [{ ...point, key: objectiveKey(category.key, item.id), map: item.map ? 'tree' : 'palpagos',
      category: category.key, categoryName: category.title, item }];
  }));
}

/** Normalized terrain position; north is at the top. */
export function project(point: MapPoint, map: MapDefinition): MapPoint {
  return { x: (point.x - map.minX) / (map.maxX - map.minX), y: (map.maxY - point.y) / (map.maxY - map.minY) };
}
export function unproject(point: MapPoint, map: MapDefinition): MapPoint {
  return { x: map.minX + point.x * (map.maxX - map.minX), y: map.maxY - point.y * (map.maxY - map.minY) };
}
export function distanceSquared(a: MapPoint, b: MapPoint): number { return (a.x-b.x)**2 + (a.y-b.y)**2; }

/** Only actual, unlocked travel statues in the same map are useful starting points. */
export function nearestTravel(target: MapObjective, objectives: MapObjective[]): MapObjective | null {
  return objectives.filter(p => p.map === target.map && p.category === 'fastTravel'
    && p.item.group === 'statue' && p.item.state === 'done' && p.key !== target.key)
    .sort((a,b) => distanceSquared(a,target)-distanceSquared(b,target))[0] ?? null;
}

/** Any chain of icons within 8px belongs to the same bubble. */
export function clusterMarkers(points: MapObjective[], screen: (p: MapObjective) => MapPoint, distance = 8): MarkerCluster[] {
  const positions = points.map(screen);
  const buckets = new Map<string, Set<number>>();
  const bucketKey = (point: MapPoint) => `${Math.floor(point.x / distance)},${Math.floor(point.y / distance)}`;
  positions.forEach((point, index) => {
    const key = bucketKey(point), bucket = buckets.get(key) ?? new Set<number>();
    bucket.add(index); buckets.set(key, bucket);
  });
  const visited = new Set<number>();
  const clusters: MarkerCluster[] = [];
  for (let seed = 0; seed < points.length; seed++) {
    if (visited.has(seed)) continue;
    const members = [seed];
    visited.add(seed); buckets.get(bucketKey(positions[seed]))!.delete(seed);
    for (let cursor = 0; cursor < members.length; cursor++) {
      const point = positions[members[cursor]];
      const bx = Math.floor(point.x / distance), by = Math.floor(point.y / distance);
      for (let x = bx - 1; x <= bx + 1; x++) for (let y = by - 1; y <= by + 1; y++) {
        const bucket = buckets.get(`${x},${y}`);
        if (!bucket) continue;
        for (const index of bucket) {
          if (distanceSquared(point, positions[index]) > distance ** 2) continue;
          // Search around every member, so a connecting icon also joins neighboring bubbles.
          bucket.delete(index); visited.add(index); members.push(index);
        }
      }
    }
    members.sort((a, b) => a - b);
    clusters.push({
      x: members.reduce((sum, index) => sum + positions[index].x, 0) / members.length,
      y: members.reduce((sum, index) => sum + positions[index].y, 0) / members.length,
      items: members.map(index => points[index]),
    });
  }
  return clusters;
}

export function layoutMapMarkers(points: MapObjective[], map: MapDefinition, size: number, stops: ReadonlySet<string>): MarkerCluster[] {
  const screen = (point: MapObjective) => {
    const position = project(point, map);
    return { x: position.x * size, y: position.y * size };
  };
  return [
    ...clusterMarkers(points.filter(point => !stops.has(point.key)), screen),
    ...points.filter(point => stops.has(point.key)).map(point => ({ ...screen(point), items: [point] })),
  ];
}

export function visibleMarkerClusters(layout: MarkerCluster[], offset: MapPoint, width: number, height: number, scale = 1): MarkerCluster[] {
  return layout.map(c => ({ x: c.x * scale + offset.x, y: c.y * scale + offset.y, items: c.items }))
    .filter(c => c.x > -25 && c.x < width + 25 && c.y > -25 && c.y < height + 25);
}
