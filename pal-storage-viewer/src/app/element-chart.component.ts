/**
 * The game's element effectiveness chart, drawn once as SVG: each arrow points from the element that
 * deals extra damage to the one that takes it (Water → Fire → Ice → Dragon → Dark → Neutral, and
 * Fire → Grass → Ground → Electric → Water). `highlight` rings the given element indexes.
 */
import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { ELEMENT_NAMES } from '../backend/lookups';

interface ChartNode { index: number; name: string; x: number; y: number; labelAbove: boolean; color: string; }

const COLORS = ['#a08a78', '#d9502c', '#2f80e0', '#e0b41c', '#5fa82a', '#6a3fa0', '#9b3fd0', '#a8642c', '#2fb0d8'];
// The left five sit on a regular pentagon (Water at the top), as in the game's chart; the right
// four continue Fire's row and Grass's row on a square grid, spaced like the game's chart.
const CENTER = { x: 215, y: 196 };
const RADIUS = 125;
const onPentagon = (angleDeg: number) => ({ x: Math.round(CENTER.x + RADIUS * Math.cos(angleDeg * Math.PI / 180)), y: Math.round(CENTER.y - RADIUS * Math.sin(angleDeg * Math.PI / 180)) });
const WATER = onPentagon(90); const FIRE = onPentagon(18); const GRASS = onPentagon(-54); const GROUND = onPentagon(-126); const ELECTRIC = onPentagon(162);
const STEP = 140;
const NODES: ChartNode[] = [
  { index: 3, name: 'Electric', ...ELECTRIC, labelAbove: true, color: COLORS[3] },
  { index: 2, name: 'Water', ...WATER, labelAbove: true, color: COLORS[2] },
  { index: 1, name: 'Fire', ...FIRE, labelAbove: true, color: COLORS[1] },
  { index: 8, name: 'Ice', x: FIRE.x + STEP, y: FIRE.y, labelAbove: true, color: COLORS[8] },
  { index: 6, name: 'Dragon', x: FIRE.x + 2 * STEP, y: FIRE.y, labelAbove: true, color: COLORS[6] },
  { index: 5, name: 'Dark', x: FIRE.x + 2 * STEP, y: GRASS.y, labelAbove: false, color: COLORS[5] },
  { index: 0, name: 'Neutral', x: FIRE.x + STEP, y: GRASS.y, labelAbove: false, color: COLORS[0] },
  { index: 4, name: 'Grass', ...GRASS, labelAbove: false, color: COLORS[4] },
  { index: 7, name: 'Ground', ...GROUND, labelAbove: false, color: COLORS[7] },
];
/** [attacker, defender] pairs. */
const ARROWS: [number, number][] = [[2, 1], [1, 8], [8, 6], [6, 5], [5, 0], [1, 4], [4, 7], [7, 3], [3, 2]];

@Component({
  selector: 'app-element-chart',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg viewBox="0 0 690 366" class="chart" role="img" aria-label="Element effectiveness chart">
      <defs>
        <marker id="element-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" fill="#8ee6ff"/>
        </marker>
      </defs>
      <line *ngFor="let arrow of arrows" [attr.x1]="arrow.x1" [attr.y1]="arrow.y1" [attr.x2]="arrow.x2" [attr.y2]="arrow.y2" stroke="#8ee6ff" stroke-width="4" stroke-linecap="round" marker-end="url(#element-arrow)"/>
      <g *ngFor="let node of nodes" [attr.transform]="'translate(' + node.x + ' ' + node.y + ')'" [class.lit]="isHighlighted(node.index)">
        <rect class="ring" x="-31" y="-31" width="62" height="62" rx="5" transform="rotate(45)"/>
        <rect class="diamond" x="-24" y="-24" width="48" height="48" rx="3" transform="rotate(45)" [attr.fill]="node.color"/>
        <image [attr.href]="iconOf(node.index)" x="-18" y="-18" width="36" height="36"/>
        <text class="label" [attr.y]="node.labelAbove ? -46 : 58" text-anchor="middle">{{ node.name }}</text>
      </g>
    </svg>
  `,
  styles: [`
    :host { display: block; }
    .chart { display: block; height: auto; width: 100%; }
    .diamond { stroke: rgba(255, 255, 255, .85); stroke-width: 2; }
    .ring { fill: none; opacity: 0; stroke: #fff; stroke-width: 3; }
    .lit .ring { opacity: 1; filter: drop-shadow(0 0 6px #8ee6ff); }
    .label { fill: #cdeeff; font-size: 20px; font-weight: 600; }
    .lit .label { fill: #fff; }
  `],
})
export class ElementChartComponent {
  /** Element indexes (ELEMENT_NAMES order) to ring, e.g. the pal's own types. */
  @Input() highlight: number[] = [];
  readonly nodes = NODES;
  readonly arrows = ARROWS.map(([from, to]) => {
    const a = NODES.find((n) => n.index === from)!;
    const b = NODES.find((n) => n.index === to)!;
    const dx = b.x - a.x; const dy = b.y - a.y; const length = Math.hypot(dx, dy);
    const ux = dx / length; const uy = dy / length;
    // A diamond is |x| + |y| <= half-diagonal, so its edge along this direction is that far divided by
    // |ux| + |uy|; every arrow then starts and ends the same distance outside the edge.
    const edge = 24 * Math.SQRT2 / (Math.abs(ux) + Math.abs(uy));
    const gap = edge + 12;
    return { x1: a.x + ux * gap, y1: a.y + uy * gap, x2: b.x - ux * gap, y2: b.y - uy * gap };
  });

  iconOf(index: number): string { return `assets/icons/element_${String(index).padStart(2, '0')}.webp`; }
  isHighlighted(index: number): boolean { return this.highlight.includes(index); }
  nameOf(index: number): string { return ELEMENT_NAMES[index] ?? ''; }
}
