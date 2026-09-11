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

/** Screen-space bubbles require at least four markers. */
export function clusterMarkers(points: MapObjective[], screen: (p: MapObjective) => MapPoint, cell = 28): MarkerCluster[] {
  const buckets = new Map<string, MarkerCluster[]>();
  const clusters: MarkerCluster[] = [];
  for (const p of points) {
    const pos = screen(p), bx = Math.floor(pos.x/cell), by = Math.floor(pos.y/cell), key = `${bx},${by}`;
    const neighbors = [];
    for (let x=bx-1;x<=bx+1;x++) for(let y=by-1;y<=by+1;y++) neighbors.push(...buckets.get(`${x},${y}`)??[]);
    const cluster = neighbors.find(c => distanceSquared(c,pos) < cell**2);
    // Keep the seed as the cluster anchor so screen hit targets and grid membership
    // remain stable; no markers are lost when neighboring cells share a cluster.
    if (cluster) cluster.items.push(p);
    else {
      const next = { ...pos, items: [p] }; clusters.push(next);
      const bucket = buckets.get(key) ?? []; bucket.push(next); buckets.set(key,bucket);
    }
  }
  return clusters.flatMap(cluster => cluster.items.length >= 4
    ? [cluster]
    : cluster.items.map(point => ({ ...screen(point), items: [point] })));
}

export const MARKER_ZOOM_STEP = 1.25;

interface MarkerNode extends MarkerCluster {
  diameter: number;
  children: MarkerNode[];
}

/** Spatial groups shared across zoom levels. */
export class MarkerHierarchy {
  private readonly root?: MarkerNode;
  private readonly stops: MarkerCluster[];

  constructor(points: MapObjective[], map: MapDefinition, stops: ReadonlySet<string>) {
    const markers = points.map(point => ({ ...project(point, map), items: [point] }));
    this.stops = markers.filter(marker => stops.has(marker.items[0].key));
    const grouped = markers.filter(marker => !stops.has(marker.items[0].key));
    if (grouped.length) this.root = this.build(grouped);
  }

  private build(markers: MarkerCluster[]): MarkerNode {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, x = 0, y = 0;
    for (const marker of markers) {
      minX = Math.min(minX, marker.x); maxX = Math.max(maxX, marker.x);
      minY = Math.min(minY, marker.y); maxY = Math.max(maxY, marker.y);
      x += marker.x; y += marker.y;
    }
    const node: MarkerNode = { x: x / markers.length, y: y / markers.length,
      items: markers.flatMap(marker => marker.items), diameter: Math.hypot(maxX - minX, maxY - minY), children: [] };
    if (markers.length > 1) {
      // Balanced splits keep dense groups together.
      const axis = maxX - minX >= maxY - minY ? 'x' : 'y';
      markers.sort((a, b) => a[axis] - b[axis] || a.items[0].key.localeCompare(b.items[0].key));
      let middle = Math.floor(markers.length / 2), largestGap = 0;
      for (let i = 1; i < markers.length; i++) {
        const gap = markers[i][axis] - markers[i - 1][axis];
        if (gap > largestGap) { largestGap = gap; }
      }
      // Separate outliers before splitting dense groups.
      if (largestGap > (markers[markers.length - 1][axis] - markers[0][axis]) / 4) {
        middle = markers.findIndex((marker, i) => i > 0 && marker[axis] - markers[i - 1][axis] === largestGap);
      }
      node.children = [this.build(markers.slice(0, middle)), this.build(markers.slice(middle))];
    }
    return node;
  }

  layout(size: number): MarkerCluster[] {
    const clusters: MarkerCluster[] = [];
    const visit = (node: MarkerNode) => {
      // 56px spans two icons. Keep smaller groups in the tree.
      if (node.items.length === 1 || (node.items.length >= 4 && node.diameter * size <= 56)) clusters.push(node);
      else node.children.forEach(visit);
    };
    if (this.root) visit(this.root);
    return [...clusters, ...this.stops].map(cluster => ({
      x: cluster.x * size, y: cluster.y * size, items: cluster.items,
    }));
  }
}

export function layoutMapMarkers(points: MapObjective[], map: MapDefinition, size: number, stops: ReadonlySet<string>, hierarchy?: MarkerHierarchy): MarkerCluster[] {
  return (hierarchy ?? new MarkerHierarchy(points, map, stops)).layout(size);
}

export function visibleMarkerClusters(layout: MarkerCluster[], offset: MapPoint, width: number, height: number, scale = 1): MarkerCluster[] {
  return layout.map(c => ({ x: c.x * scale + offset.x, y: c.y * scale + offset.y, items: c.items }))
    .filter(c => c.x > -25 && c.x < width + 25 && c.y > -25 && c.y < height + 25);
}
