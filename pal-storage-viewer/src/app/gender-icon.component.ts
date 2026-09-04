import { NgIf } from '@angular/common';
import { Component, Input } from '@angular/core';

/**
 * Vector ♀ / ♂ symbols. The Unicode glyphs are not in the app font and fall
 * back to system symbol or emoji fonts, which can render as bitmaps and look
 * pixelated at small sizes. An inline SVG stays crisp at any zoom level.
 */
@Component({
  selector: 'app-gender-icon',
  standalone: true,
  template: `
    <svg *ngIf="gender === 'female'" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="8.5" r="5.5"/>
      <path d="M12 14v8M8.5 18.5h7"/>
    </svg>
    <svg *ngIf="gender === 'male'" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="10" cy="14" r="5.5"/>
      <path d="M14 10l6-6M14.5 4H20v5.5"/>
    </svg>
  `,
  imports: [NgIf],
  styles: [`
    :host { display: inline-flex; line-height: 0; vertical-align: middle; }
    svg { fill: none; height: 1em; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 2.4; width: 1em; }
  `]
})
export class GenderIconComponent {
  @Input({ required: true }) gender: 'female' | 'male' | '' = '';
}
