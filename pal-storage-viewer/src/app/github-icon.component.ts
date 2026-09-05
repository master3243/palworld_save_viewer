import { Component } from '@angular/core';

/** The GitHub mark, sized by the parent's font-size (1em) and coloured by currentColor. */
@Component({
  selector: 'app-github-icon',
  standalone: true,
  template: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 .7a11.5 11.5 0 0 0-3.64 22.41c.58.11.79-.25.79-.56v-2.23c-3.22.7-3.9-1.37-3.9-1.37-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.71.08-.71 1.17.08 1.78 1.2 1.78 1.2 1.04 1.78 2.72 1.27 3.38.97.1-.75.4-1.27.74-1.56-2.57-.29-5.27-1.29-5.27-5.68 0-1.25.45-2.28 1.2-3.08-.12-.29-.52-1.47.11-3.05 0 0 .97-.31 3.16 1.17a10.9 10.9 0 0 1 5.75 0c2.19-1.48 3.16-1.17 3.16-1.17.63 1.58.23 2.76.11 3.05.75.8 1.2 1.83 1.2 3.08 0 4.4-2.71 5.38-5.29 5.67.42.36.79 1.06.79 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .7Z"/>
    </svg>
  `,
  styles: [`
    :host { display: inline-flex; line-height: 0; vertical-align: middle; }
    svg { fill: currentColor; height: 1em; width: 1em; }
  `]
})
export class GithubIconComponent {}
