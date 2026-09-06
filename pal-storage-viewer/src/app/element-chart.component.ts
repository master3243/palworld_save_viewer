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
const NODES: ChartNode[] = [
  { index: 3, name: 'Electric', x: 100, y: 180, labelAbove: true, color: COLORS[3] },
  { index: 2, name: 'Water', x: 215, y: 95, labelAbove: true, color: COLORS[2] },
  { index: 1, name: 'Fire', x: 330, y: 180, labelAbove: true, color: COLORS[1] },
  { index: 8, name: 'Ice', x: 445, y: 180, labelAbove: true, color: COLORS[8] },
  { index: 6, name: 'Dragon', x: 560, y: 180, labelAbove: true, color: COLORS[6] },
  { index: 5, name: 'Dark', x: 560, y: 300, labelAbove: false, color: COLORS[5] },
  { index: 0, name: 'Neutral', x: 445, y: 300, labelAbove: false, color: COLORS[0] },
  { index: 4, name: 'Grass', x: 330, y: 300, labelAbove: false, color: COLORS[4] },
  { index: 7, name: 'Ground', x: 215, y: 300, labelAbove: false, color: COLORS[7] },
];
/** [attacker, defender] pairs. */
const ARROWS: [number, number][] = [[2, 1], [1, 8], [8, 6], [6, 5], [5, 0], [1, 4], [4, 7], [7, 3], [3, 2]];

@Component({
  selector: 'app-element-chart',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg viewBox="0 0 660 390" class="chart" role="img" aria-label="Element effectiveness chart">
      <defs>
        <marker id="element-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" fill="#8ee6ff"/>
        </marker>
      </defs>
      <line *ngFor="let arrow of arrows" [attr.x1]="arrow.x1" [attr.y1]="arrow.y1" [attr.x2]="arrow.x2" [attr.y2]="arrow.y2" stroke="#8ee6ff" stroke-width="5" stroke-linecap="round" marker-end="url(#element-arrow)"/>
      <g *ngFor="let node of nodes" [attr.transform]="'translate(' + node.x + ' ' + node.y + ')'" [class.lit]="isHighlighted(node.index)">
        <rect class="ring" x="-40" y="-40" width="80" height="80" rx="6" transform="rotate(45)"/>
        <rect class="diamond" x="-30" y="-30" width="60" height="60" rx="4" transform="rotate(45)" [attr.fill]="node.color"/>
        <image [attr.href]="iconOf(node.index)" x="-18" y="-18" width="36" height="36"/>
        <text class="label" [attr.y]="node.labelAbove ? -52 : 64" text-anchor="middle">{{ node.name }}</text>
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
    const gap = 50; // start and end just outside the diamonds
    return { x1: a.x + dx / length * gap, y1: a.y + dy / length * gap, x2: b.x - dx / length * gap, y2: b.y - dy / length * gap };
  });

  iconOf(index: number): string { return `assets/icons/element_${String(index).padStart(2, '0')}.webp`; }
  isHighlighted(index: number): boolean { return this.highlight.includes(index); }
  nameOf(index: number): string { return ELEMENT_NAMES[index] ?? ''; }
}
