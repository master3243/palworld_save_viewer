import { CommonModule } from '@angular/common';
import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, EventEmitter, HostListener, Input, NgZone, OnChanges, OnDestroy, SimpleChanges, Output, ViewChild } from '@angular/core';
import type { Category } from './completion-model';
import { CATEGORY_COLORS, CATEGORY_ICONS, STATE_LABELS, MapDefinition, MapObjective, MapPoint, MarkerCluster,
  distanceSquared, layoutMapMarkers, MarkerHierarchy, MARKER_ZOOM_STEP, mapObjectives, nearestTravel, parseCoordinates, project, unproject, visibleMarkerClusters } from './tracker-map-model';
@Component({
  selector: 'app-tracker-map', standalone: true, imports: [CommonModule],
  templateUrl: './tracker-map.component.html', styleUrl: './tracker-map.component.css',
})
export class TrackerMapComponent implements OnChanges, AfterViewInit, OnDestroy {
  @Input() categories: Category[] = [];
  @Input() playerKey = '';
  @Input() focusKey = '';
  @Input() visible = true;
  @Output() openCategory = new EventEmitter<{ category: string; itemId?: string }>();
  @ViewChild('canvas', { static: true }) canvas!: ElementRef<HTMLCanvasElement>;

  readonly colors = CATEGORY_COLORS;
  readonly iconNames = CATEGORY_ICONS;
  iconUrls: Record<string, string> = {};
  hovered: MapObjective | null = null;
  hoverCluster: MarkerCluster | null = null;
  clusterAnchor: MapPoint | null = null;
  @ViewChild('popup') popup?: ElementRef<HTMLElement>;
  @ViewChild('hoverPopup') hoverPopup?: ElementRef<HTMLElement>;
  readonly states = STATE_LABELS;
  maps: MapDefinition[] = [];
  mapKey = 'palpagos';
  objectives: MapObjective[] = [];
  filtered: MapObjective[] = [];
  nearby: MapObjective[] = [];
  layers: { key: string; name: string; palpagos: number; tree: number }[] = [];
  enabled = new Set<string>();
  status = 'missing';
  search = '';
  group = '';
  groupOptions: { key: string; name: string }[] = [];
  selected: MapObjective | null = null;
  travel: MapObjective | null = null;
  clusterItems: MapObjective[] = [];
  route: MapObjective[] = [];
  limit = 60;
  full = false;
  loadError = '';
  imageError = '';
  message = '';
  coordinateText = '';
  coordinateError = '';
  centerCoords = '';
  cursorCoords = '';
  unmapped: Category[] = [];

  private observer?: ResizeObserver;
  private image?: HTMLImageElement;
  private icons = new Map<string, HTMLImageElement>();
  private tiles = new Map<string, HTMLImageElement>();
  private width = 1;
  private height = 1;
  private zoom = 1;
  private center = { x: .5, y: .5 };
  private clusters: MarkerCluster[] = [];
  private markerLayout?: { points: MapObjective[]; map: MapDefinition; size: number; zoom: number; viewportSize: number; stops: string; hierarchy: MarkerHierarchy; clusters: MarkerCluster[] };
  private frame = 0;
  private initialized = false;
  private destroyed = false;
  private lastPlayer = '';
  private pointers = new Map<number, MapPoint>();
  private gesture: { center: MapPoint; distance: number } | null = null;
  private down: MapPoint | null = null;
  private dragged = false;

  constructor(private readonly cd: ChangeDetectorRef, private readonly zone: NgZone) {}

  get map(): MapDefinition | undefined { return this.maps.find(m => m.key === this.mapKey); }
  get routeHere(): MapObjective[] { return this.route.filter(p => p.map === this.mapKey); }
  get storageKey(): string { return `tracker-trip:${this.playerKey}`; }
  get size(): number { return Math.min(this.width, this.height) * this.zoom; }
  get maxZoom(): number { return 128; }
  get searchHasNoResults(): boolean { return !!this.search.trim() && !!this.maps.length && !this.filtered.length; }
  get coordsLabel(): string { return this.mapKey === 'tree' ? 'World Tree coordinates' : 'Map coordinates'; }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.visible) { this.clearHover(); this.full = false; }
    if (!changes['categories'] && !changes['playerKey']) {
      if (changes['focusKey'] && this.focusKey) this.focusObjective(this.focusKey);
      if (this.visible) this.queueDraw();
      return;
    }
    this.objectives = mapObjectives(this.categories);
    this.unmapped = this.categories.filter(c => !c.needsFile && c.items.some(i => i.state !== 'done' && i.counted !== false && !i.coords));
    if (this.lastPlayer !== this.playerKey) {
      this.lastPlayer = this.playerKey;
      this.selected = null; this.travel = null; this.clusterItems = []; this.message = '';
      this.restoreRoute();
    } else this.route = this.route.flatMap(p => this.objectives.find(o => o.key === p.key) ?? []);
    if (this.selected) {
      this.selected = this.objectives.find(p => p.key === this.selected?.key) ?? null;
      this.travel = this.selected ? nearestTravel(this.selected,this.objectives) : null;
    }
    if (!this.initialized) { this.enabled = new Set(this.categories.filter(c => c.hasCoords).map(c => c.key)); this.initialized = true; }
    this.refresh();
    if (this.focusKey) this.focusObjective(this.focusKey);
  }

  ngAfterViewInit(): void {
    this.observer = new ResizeObserver(() => {
      const rect = this.canvas.nativeElement.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      this.width = Math.max(1, rect.width); this.height = Math.max(1, rect.height);
      this.zoom = Math.min(this.zoom,this.maxZoom);
      const ratio = window.devicePixelRatio || 1;
      this.canvas.nativeElement.width = Math.round(this.width * ratio);
      this.canvas.nativeElement.height = Math.round(this.height * ratio);
      this.queueDraw();
    });
    this.observer.observe(this.canvas.nativeElement);
    void this.load();
  }

  ngOnDestroy(): void { this.destroyed = true; this.observer?.disconnect(); cancelAnimationFrame(this.frame); }

  private async load(): Promise<void> {
    try {
      const response = await fetch(new URL('resources/completion/maps/maps.json', document.baseURI));
      if (!response.ok) throw new Error('Could not load the maps. Reload to try again.');
      this.maps = await response.json() as MapDefinition[];
      if (this.destroyed) return;
      const iconResponse = await fetch(new URL('resources/completion/maps/icons.json', document.baseURI));
      if (iconResponse.ok) {
        const paths: Record<string, string> = await iconResponse.json();
        for (const [name,path] of Object.entries(paths)) {
          this.icons.set(name,this.loadPackedImage(path,image => { this.iconUrls[name] = image.src; }));
        }
      }
      this.loadImage();
      this.refresh();
      if (this.focusKey) this.focusObjective(this.focusKey);
      this.cd.markForCheck();
    } catch (error) { this.loadError = error instanceof Error ? error.message : 'Could not load the maps.'; this.cd.markForCheck(); }
  }

  private loadPackedImage(path: string, onLoad?: (image: HTMLImageElement) => void, onError?: () => void): HTMLImageElement {
    const image = new Image();
    const failed = () => { if (!this.destroyed) { onError?.(); this.cd.markForCheck(); } };
    image.onload = () => {
      if (this.destroyed) return;
      onLoad?.(image); this.queueDraw(); this.cd.markForCheck();
    };
    image.onerror = failed;
    void fetch(new URL(path,document.baseURI)).then(async response => {
      if (!response.ok) throw new Error('Image unavailable');
      const source = await response.text();
      if (!this.destroyed) image.src = source.trim();
    }).catch(failed);
    return image;
  }

  private loadImage(): void {
    if (!this.map) return;
    this.imageError = '';
    const image = this.loadPackedImage(this.map.image, undefined, () => {
      if (this.image !== image) return;
      this.imageError = 'Terrain image unavailable. Markers and coordinates are still usable.';
    });
    this.image = image;
  }

  changeMap(key: string): void {
    if (this.mapKey === key) return;
    this.mapKey = key; this.selected = null; this.travel = null; this.clusterItems = []; this.hovered = null; this.hoverCluster = null; this.clusterAnchor = null; this.tiles.clear();
    this.coordinateText = ''; this.coordinateError = ''; this.zoom = 1; this.center = { x: .5, y: .5 };
    this.loadImage(); this.refresh();
  }

  refresh(): void {
    const points = this.objectives.filter(p => p.map === this.mapKey);
    const matchesState = (p: MapObjective) => this.status === 'all' || (this.status === 'missing' ? p.item.state !== 'done' : p.item.state === this.status);
    this.layers = this.categories.filter(c => c.hasCoords).map(c => ({ key: c.key, name: c.title,
      palpagos: this.objectives.filter(p => p.category === c.key && p.map === 'palpagos' && matchesState(p)).length,
      tree: this.objectives.filter(p => p.category === c.key && p.map === 'tree' && matchesState(p)).length }));
    this.groupOptions = this.enabled.size === 1 ? this.categories.find(c => this.enabled.has(c.key))?.groups
      .filter(group => this.objectives.some(point => this.enabled.has(point.category) && point.item.group === group.key)) ?? [] : [];
    if (!this.groupOptions.some(g => g.key === this.group)) this.group = '';
    const needle = this.search.trim().toLowerCase();
    this.filtered = points.filter(p => this.enabled.has(p.category) && matchesState(p) && (!this.group || p.item.group === this.group)
      && (!needle || `${p.item.name} ${p.item.detail} ${p.categoryName} ${p.item.coords}`.toLowerCase().includes(needle)));
    this.limit = 60; this.clearSelection(); this.updateNearby(); this.queueDraw();
  }

  toggleLayer(key: string): void {
    if (this.enabled.has(key)) this.enabled.delete(key); else this.enabled.add(key);
    this.refresh();
  }
  allLayers(on: boolean): void { this.enabled = new Set(on ? this.layers.map(l => l.key) : []); this.refresh(); }
  setStatus(value: string): void { this.status = value; this.refresh(); }
  setSearch(value: string): void { this.search = value; this.refresh(); }
  setGroup(value: string): void { this.group = value; this.refresh(); }

  focusObjective(key: string): void {
    const point = this.objectives.find(p => p.key === key);
    if (!point) return;
    if (point.map !== this.mapKey) this.changeMap(point.map);
    this.enabled.add(point.category);
    if (point.item.state === 'done') this.status = 'all';
    this.search = ''; this.group = ''; this.refresh(); this.select(point, true);
  }

  select(point: MapObjective, focus = false): void {
    if (point.map !== this.mapKey) this.changeMap(point.map);
    if (focus && !this.filtered.some(p => p.key === point.key)) {
      this.enabled.add(point.category); this.status = point.item.state === 'done' ? 'all' : 'missing';
      this.search = ''; this.group = ''; this.refresh();
    }
    this.hovered = null; this.hoverCluster = null; this.clusterItems = []; this.clusterAnchor = null;
    this.selected = point; this.travel = nearestTravel(point, this.objectives); this.message = '';
    if (focus && this.map) { this.center = project(point, this.map); this.zoom = Math.min(this.maxZoom,Math.max(this.zoom, 4)); this.updateNearby(); }
    if (focus && window.matchMedia('(max-width: 720px)').matches) {
      requestAnimationFrame(() => this.canvas?.nativeElement.scrollIntoView({ block:'start', behavior:'smooth' }));
    }
    this.queueDraw();
  }

  clearSelection(): void { this.selected = null; this.travel = null; this.hovered = null; this.hoverCluster = null; this.clusterItems = []; this.clusterAnchor = null; this.queueDraw(); }

  private updateNearby(): void {
    if (!this.map) return;
    const origin = unproject(this.center, this.map);
    this.centerCoords = `${Math.round(origin.x)}, ${Math.round(origin.y)}`;
    this.nearby = [...this.filtered].sort((a,b) => distanceSquared(a, origin) - distanceSquared(b, origin) || a.key.localeCompare(b.key));
  }

  jump(): void {
    const point = parseCoordinates(this.coordinateText), map = this.map;
    if (!point || !map) { this.coordinateError = 'Enter coordinates as x, y.'; return; }
    const pos = project(point, map);
    if (pos.x < 0 || pos.x > 1 || pos.y < 0 || pos.y > 1) { this.coordinateError = 'Those coordinates are outside this map.'; return; }
    this.coordinateError = ''; this.clearSelection(); this.center = pos; this.zoom = Math.min(this.maxZoom,Math.max(this.zoom, 4));
    this.updateNearby(); this.queueDraw();
  }

  routeIndex(point: MapObjective): number { return this.routeHere.findIndex(p => p.key === point.key); }
  toggleRoute(point: MapObjective): void {
    const index = this.route.findIndex(p => p.key === point.key);
    if (index >= 0) this.route.splice(index, 1); else this.route.push(point);
    this.saveRoute(); this.queueDraw();
  }
  moveStop(point: MapObjective, direction: number): void {
    const here = this.routeHere, index = here.findIndex(p => p.key === point.key), next = here[index + direction];
    if (!next) return;
    const a = this.route.indexOf(point), b = this.route.indexOf(next);
    [this.route[a], this.route[b]] = [this.route[b], this.route[a]]; this.saveRoute(); this.queueDraw();
  }
  clearRoute(): void { this.route = this.route.filter(p => p.map !== this.mapKey); this.saveRoute(); this.queueDraw(); }

  private restoreRoute(): void {
    this.route = [];
    try {
      const keys: unknown = JSON.parse(localStorage.getItem(this.storageKey) ?? '[]');
      if (Array.isArray(keys)) this.route = [...new Set(keys)].flatMap(key => this.objectives.find(p => p.key === key) ?? []);
    } catch { /* Storage can be unavailable; trips still work for the open map. */ }
  }
  private saveRoute(): void {
    try { localStorage.setItem(this.storageKey, JSON.stringify(this.route.map(p => p.key))); }
    catch { this.message = 'Trip kept for this session; browser storage is unavailable.'; }
  }

  exportRoute(): void {
    const rows = [['Stop', 'Objective', 'Category', 'Map', 'X', 'Y', 'Status'], ...this.routeHere.map((p,i) => [i+1, p.item.name, p.categoryName, this.map?.name ?? '', Math.round(p.x), Math.round(p.y), this.states[p.item.state]])];
    const csv = rows.map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `tracker-trip-${this.mapKey}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  zoomToGroup(): void {
    if (!this.map || this.clusterItems.length < 2) return;
    const positions = this.clusterItems.map(p => project(p, this.map!));
    let nearest = Infinity;
    for (let i = 0; i < positions.length; i++) for (let j = i + 1; j < positions.length; j++) {
      const distance = Math.sqrt(distanceSquared(positions[i], positions[j]));
      if (distance > 0) nearest = Math.min(nearest, distance);
    }
    // Leave coincident objectives in their selectable list; zoom cannot separate them.
    if (!Number.isFinite(nearest)) return;
    const needed = Math.max(this.zoom, 32 / (nearest * Math.min(this.width, this.height)));
    this.fit(this.clusterItems);
    this.zoom = Math.min(this.zoom, needed);
    this.clearSelection();
  }

  fit(points: MapObjective[] = []): void {
    if (!this.map) return;
    if (!points.length) { this.center = { x: .5, y: .5 }; this.zoom = 1; }
    else {
      const positions = points.map(p => project(p, this.map!));
      const xs = positions.map(p => p.x), ys = positions.map(p => p.y);
      const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
      this.center = { x: (minX+maxX)/2, y: (minY+maxY)/2 };
      this.zoom = Math.max(1, Math.min(this.maxZoom, .8*this.width/Math.max(1,(maxX-minX)*Math.min(this.width,this.height)), .8*this.height/Math.max(1,(maxY-minY)*Math.min(this.width,this.height))));
    }
    this.updateNearby(); this.queueDraw();
  }

  zoomBy(factor: number, anchor = { x: this.width/2, y: this.height/2 }): void {
    this.clearHover();
    const before = this.normalized(anchor);
    this.zoom = Math.min(this.maxZoom, Math.max(1, this.zoom * factor));
    const after = this.normalized(anchor);
    this.center.x += before.x-after.x; this.center.y += before.y-after.y;
    this.clamp(); this.updateNearby(); this.queueDraw();
  }
  wheel(event: WheelEvent): void { event.preventDefault(); this.zoomBy(Math.exp(-Math.max(-100,Math.min(100,event.deltaY))*.003), this.local(event)); }
  keydown(event: KeyboardEvent): void {
    if (['+', '=', '-', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(event.key)) event.preventDefault();
    if (event.key === '+' || event.key === '=') this.zoomBy(1.4);
    else if (event.key === '-') this.zoomBy(1/1.4);
    else if (event.key === 'Home') this.fit();
    else {
      const delta = 60/this.size;
      if (event.key === 'ArrowLeft') this.center.x -= delta;
      if (event.key === 'ArrowRight') this.center.x += delta;
      if (event.key === 'ArrowUp') this.center.y -= delta;
      if (event.key === 'ArrowDown') this.center.y += delta;
      this.clamp(); this.updateNearby(); this.queueDraw();
    }
  }
  @HostListener('document:keydown.escape') escape(): void { if (!this.visible) return; if (this.full) this.full = false; else this.clearSelection(); }

  pointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    this.clearHover();
    this.canvas.nativeElement.setPointerCapture(event.pointerId);
    const point = this.local(event); this.pointers.set(event.pointerId, point);
    if (this.pointers.size === 1) { this.down = point; this.dragged = false; }
    else this.dragged = true;
    this.gesture = this.gestureState();
  }
  pointerMove(event: PointerEvent): void {
    if (event.pointerType === 'mouse' && this.map) {
      const point = unproject(this.normalized(this.local(event)),this.map);
      this.cursorCoords = `X: ${Math.round(point.x)}  Y: ${Math.round(point.y)}`;
    }
    if (!this.pointers.has(event.pointerId)) {
      if (event.pointerType === 'mouse') {
        const cluster = this.markerAt(this.local(event), 15);
        this.hovered = cluster?.items.length === 1 && cluster.items[0].key !== this.selected?.key ? cluster.items[0] : null;
        const pinned = cluster?.items.length === this.clusterItems.length && cluster.items.every((p, i) => p.key === this.clusterItems[i].key);
        this.hoverCluster = cluster && cluster.items.length > 1 && !pinned ? cluster : null;
        this.queueDraw();
      }
      return;
    }
    const point = this.local(event); this.pointers.set(event.pointerId, point);
    if (this.down && distanceSquared(point,this.down)>25) this.dragged = true;
    const next = this.gestureState(), prev = this.gesture;
    if (next && prev) {
      const before = this.normalized(prev.center);
      if (next.distance && prev.distance) this.zoom = Math.max(1, Math.min(this.maxZoom,this.zoom*next.distance/prev.distance));
      const after = this.normalized(next.center);
      this.center.x += before.x-after.x; this.center.y += before.y-after.y;
      this.clamp(); this.queueDraw();
    }
    this.gesture = next;
  }
  pointerUp(event: PointerEvent): void {
    if (!this.pointers.has(event.pointerId)) return;
    this.pointers.delete(event.pointerId); this.gesture = this.gestureState();
    if (!this.pointers.size) {
      this.updateNearby();
      if (event.type === 'pointercancel') this.dragged = true;
      this.down = null;
    }
  }
  canvasClick(event: MouseEvent): void {
    // Open after the browser's compatibility click, so a touch cannot click
    // through a popup inserted beneath the finger during pointerup.
    if (!this.dragged && !this.pointers.size) this.hit(this.local(event));
  }
  private gestureState(): { center: MapPoint; distance: number } | null {
    const [a,b] = [...this.pointers.values()];
    return a ? { center: b ? { x:(a.x+b.x)/2, y:(a.y+b.y)/2 } : a, distance: b ? Math.sqrt(distanceSquared(a,b)) : 0 } : null;
  }
  private local(event: MouseEvent): MapPoint {
    const rect = this.canvas.nativeElement.getBoundingClientRect(); return { x:event.clientX-rect.left, y:event.clientY-rect.top };
  }
  private normalized(p: MapPoint): MapPoint { return { x:this.center.x+(p.x-this.width/2)/this.size, y:this.center.y+(p.y-this.height/2)/this.size }; }
  private screen(p: MapPoint): MapPoint {
    const n = project(p,this.map!); return { x:(n.x-this.center.x)*this.size+this.width/2, y:(n.y-this.center.y)*this.size+this.height/2 };
  }
  private clamp(): void { this.center.x = Math.min(1,Math.max(0,this.center.x)); this.center.y = Math.min(1,Math.max(0,this.center.y)); }

  leaveMap(): void { this.cursorCoords = ''; this.clearHover(); }

  clearHover(): void { this.hovered = null; this.hoverCluster = null; this.queueDraw(); }

  private markerAt(point: MapPoint, radius = 16): MarkerCluster | undefined {
    return this.clusters.filter(c => distanceSquared(c,point) < radius**2)
      .sort((a,b) => distanceSquared(a,point)-distanceSquared(b,point))[0];
  }
  private hit(point: MapPoint): void {
    const cluster = this.markerAt(point);
    if (!cluster) { this.clearSelection(); return; }
    if (cluster.items.length === 1) this.select(cluster.items[0]);
    else {
      this.clearSelection(); this.clusterItems = cluster.items;
      this.clusterAnchor = unproject(this.normalized(cluster),this.map!);
      this.queueDraw();
    }
  }

  get popupPinned(): boolean { return !!this.selected || !!this.clusterItems.length; }

  private positionPopup(): void {
    if (!this.map) return;
    const pinned = this.popup?.nativeElement;
    const anchor = this.selected ?? this.clusterAnchor;
    if (pinned && anchor) this.positionPopupElement(pinned, this.screen(anchor));
    const preview = this.hoverPopup?.nativeElement;
    const hovered = this.hovered ? this.screen(this.hovered) : this.hoverCluster;
    if (preview && hovered) this.positionPopupElement(preview, hovered, pinned);
  }

  private positionPopupElement(el: HTMLElement, point: MapPoint, pinned?: HTMLElement): void {
    const onMap = point.x >= 0 && point.x <= this.width && point.y >= 0 && point.y <= this.height;
    el.style.visibility = onMap ? 'visible' : 'hidden';
    el.style.setProperty('--popup-height', `${Math.max(80,Math.min(240,Math.max(point.y-20,this.height-point.y-20)))}px`);
    const w = el.offsetWidth, h = el.offsetHeight;
    const left = Math.max(6,Math.min(this.width-w-6,point.x-w/2));
    let below = point.y < h + 20;
    let top = below ? point.y + 14 : point.y - h - 14;
    if (pinned?.style.visibility === 'visible') {
      const overlaps = (y: number) => left < pinned.offsetLeft + pinned.offsetWidth && left + w > pinned.offsetLeft
        && y < pinned.offsetTop + pinned.offsetHeight && y + h > pinned.offsetTop;
      const alternate = below ? point.y - h - 14 : point.y + 14;
      if (overlaps(top) && alternate >= 6 && alternate + h <= this.height - 6 && !overlaps(alternate)) {
        below = !below;
        top = alternate;
      }
    }
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.setProperty('--arrow-left', `${point.x-left}px`);
    el.classList.toggle('below',below);
  }

  iconName(point: MapObjective): string {
    return point.category === 'relics' ? point.item.name : point.category === 'fastTravel' && point.item.group !== 'statue' ? 'Watchtower' : this.iconNames[point.category];
  }

  private queueDraw(): void {
    if (this.frame || this.destroyed || !this.visible) return;
    this.zone.runOutsideAngular(() => { this.frame = requestAnimationFrame(() => { this.frame = 0; this.draw(); }); });
  }

  private draw(): void {
    const canvas = this.canvas?.nativeElement, map = this.map;
    if (!canvas || !map || !this.visible) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    ctx.setTransform(canvas.width/this.width,0,0,canvas.height/this.height,0,0);
    ctx.clearRect(0,0,this.width,this.height);
    ctx.fillStyle = '#0b161c'; ctx.fillRect(0,0,this.width,this.height);
    const left = this.width/2-this.center.x*this.size, top = this.height/2-this.center.y*this.size;
    if (this.image?.complete && this.image.naturalWidth) ctx.drawImage(this.image,left,top,this.size,this.size);
    ctx.fillStyle = 'rgba(2,10,16,.12)'; ctx.fillRect(0,0,this.width,this.height);
    this.drawTerrainDetail(ctx,left,top);
    this.clusters = [];
    if (!this.filtered.length) return;
    const visibleKeys = new Set(this.filtered.map(p => p.key));
    const route = this.routeHere;
    ctx.beginPath();
    for (let i=1;i<route.length;i++) if (visibleKeys.has(route[i-1].key) && visibleKeys.has(route[i].key)) {
      const a=this.screen(route[i-1]),b=this.screen(route[i]); ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);
    }
    ctx.strokeStyle='#fff0b0';ctx.lineWidth=1.5;ctx.setLineDash([5,4]);ctx.stroke();ctx.setLineDash([]);
    const stops = new Map(route.map((p,i) => [p.key,i+1]));
    const stopKeys = JSON.stringify([...stops.keys()]);
    const viewportSize = Math.min(this.width, this.height);
    // Measure from the last regrouping to prevent zoom flicker.
    if (!this.markerLayout || this.markerLayout.points !== this.filtered || this.markerLayout.map !== map
      || this.markerLayout.stops !== stopKeys || this.markerLayout.viewportSize !== viewportSize
      || this.zoom >= this.markerLayout.zoom * MARKER_ZOOM_STEP
      || this.zoom <= this.markerLayout.zoom / MARKER_ZOOM_STEP) {
      const hierarchy = this.markerLayout?.points === this.filtered && this.markerLayout.map === map
        && this.markerLayout.stops === stopKeys ? this.markerLayout.hierarchy
        : new MarkerHierarchy(this.filtered, map, new Set(stops.keys()));
      this.markerLayout = { points: this.filtered, map, size: this.size, zoom: this.zoom, viewportSize, stops: stopKeys, hierarchy,
        clusters: layoutMapMarkers(this.filtered, map, this.size, new Set(stops.keys()), hierarchy) };
    }
    // Rescale cached positions to keep hit targets aligned.
    this.clusters = visibleMarkerClusters(this.markerLayout.clusters, { x: left, y: top }, this.width, this.height, this.size / this.markerLayout.size);
    for (const cluster of this.clusters) {
      if (cluster.items.length > 1) {
        ctx.beginPath();ctx.arc(cluster.x,cluster.y,10,0,Math.PI*2);ctx.fillStyle='#102632';ctx.fill();
        ctx.strokeStyle='#b6dae6';ctx.lineWidth=1;ctx.stroke();ctx.fillStyle='#e5f6fa';
        ctx.font='600 10px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(cluster.items.length),cluster.x,cluster.y);
      } else this.drawObjective(ctx,cluster.items[0],stops.get(cluster.items[0].key));
    }
    if (this.selected) {
      const p=this.screen(this.selected);ctx.beginPath();ctx.arc(p.x,p.y,16,0,Math.PI*2);ctx.strokeStyle='#fff';ctx.lineWidth=1.5;ctx.stroke();
    }
    this.positionPopup();
  }

  private drawObjective(ctx: CanvasRenderingContext2D, point: MapObjective, stop?: number): void {
    const p=this.screen(point), icon=this.icons.get(this.iconName(point));
    ctx.beginPath();ctx.arc(p.x,p.y,14,0,Math.PI*2);ctx.fillStyle='#0a1925ed';ctx.fill();
    ctx.strokeStyle='#7a9cac';ctx.lineWidth=.75;ctx.stroke();
    ctx.save();ctx.shadowColor='#001018';ctx.shadowBlur=2;
    if(icon?.complete && icon.naturalWidth) {
      const scale=Math.min(18/Math.max(icon.naturalWidth,icon.naturalHeight),20/Math.hypot(icon.naturalWidth,icon.naturalHeight))*(point.category === 'fastTravel' ? 1.5 : point.category === 'relics' ? 1.1 : point.category === 'bounties' ? 1.44 : point.category === 'towers' || point.category === 'towersHard' ? 1.44 : point.category === 'areas' || point.category === 'notes' || point.category === 'alphas' || point.category === 'mainQuests' || point.category === 'sideQuests' ? 1.2 : 1), w=icon.naturalWidth*scale,h=icon.naturalHeight*scale;
      ctx.drawImage(icon,p.x-w/2,p.y-h/2,w,h);
    }
    else { ctx.fillStyle=this.colors[point.category]??'#d0e7ee';ctx.beginPath();ctx.arc(p.x,p.y,5,0,Math.PI*2);ctx.fill(); }
    ctx.restore();
    if (stop !== undefined) {
      ctx.fillStyle='#ffe09a';ctx.beginPath();ctx.arc(p.x-11,p.y+11,7,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#162331';ctx.font='700 9px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(stop),p.x-11,p.y+11);
    }
    if(point.item.state==='done') {
      const x=p.x+10,y=p.y-10;
      ctx.beginPath();ctx.arc(x,y,5,0,Math.PI*2);ctx.fillStyle='#092519';ctx.fill();
      ctx.beginPath();ctx.moveTo(x-3,y);ctx.lineTo(x-1,y+2);ctx.lineTo(x+3,y-3);
      ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle='#55f695';ctx.lineWidth=1.7;ctx.stroke();
    }
  }

  private drawTerrainDetail(ctx: CanvasRenderingContext2D, left: number, top: number): void {
    const map=this.map;
    if(!map?.detail || this.size*(window.devicePixelRatio||1)<=2048) return;
    const count=4, tileSize=this.size/count;
    const active=new Set<string>();
    for(let y=0;y<count;y++) for(let x=0;x<count;x++) {
      const dx=left+x*tileSize,dy=top+y*tileSize;
      if(dx>this.width||dy>this.height||dx+tileSize<0||dy+tileSize<0) continue;
      const key=`${map.key}/${x}-${y}`;active.add(key);
      let tile=this.tiles.get(key);
      if(!tile){tile=this.loadPackedImage(`${map.detail}/${x}-${y}.pog`);this.tiles.set(key,tile);}
      if(tile.complete&&tile.naturalWidth)ctx.drawImage(tile,dx,dy,tileSize,tileSize);
    }
    // Keep only visible detail images; the small overview covers loading tiles.
    for(const key of this.tiles.keys()) if(!active.has(key))this.tiles.delete(key);
  }
  trackPoint(_index: number, point: MapObjective): string { return point.key; }
}
