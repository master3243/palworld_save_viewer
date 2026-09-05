/**
 * Game-style hover card: a title bar, an optional element badge with clock/power figures, a table of
 * rows, and free text. `[appTooltip]` shows one for any element and removes it on leave/blur.
 */
import { CommonModule } from '@angular/common';
import {
  ApplicationRef, Component, ComponentRef, Directive, ElementRef, EnvironmentInjector, HostListener, Input, OnDestroy, createComponent,
} from '@angular/core';

export interface TooltipData {
  title: string;
  /** Element chip like the game's skill card (index into the element icon set). */
  badge?: { text: string; iconSrc?: string; element?: number };
  /** Figures shown right of the badge, e.g. cooldown and power. */
  stats?: { icon?: 'clock' | 'power'; label: string; value: string }[];
  /** Label/value rows, e.g. a stat breakdown. */
  rows?: [string, string][];
  lines?: string[];
  note?: string;
}

@Component({
  selector: 'app-game-tooltip',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="tip" [style.left.px]="x" [style.top.px]="y" [class.ready]="ready">
      <div class="tip-title">{{ data.title }}</div>
      <div class="tip-badges" *ngIf="data.badge || data.stats?.length">
        <span class="tip-badge" *ngIf="data.badge" [attr.data-element]="data.badge.element">
          <img *ngIf="data.badge.iconSrc" [src]="data.badge.iconSrc" alt="">{{ data.badge.text }}
        </span>
        <span class="tip-stat" *ngFor="let stat of data.stats"><i [attr.data-icon]="stat.icon"></i>{{ stat.label }}<b>{{ stat.value }}</b></span>
      </div>
      <div class="tip-rows" *ngIf="data.rows?.length">
        <div class="tip-row" *ngFor="let row of data.rows" [class.total]="row[0] === 'Total'"><span>{{ row[0] }}</span><b>{{ row[1] }}</b></div>
      </div>
      <p class="tip-line" *ngFor="let line of data.lines">{{ line }}</p>
      <p class="tip-note" *ngIf="data.note">{{ data.note }}</p>
    </div>
  `,
  styles: [`
    .tip { background: rgba(14, 24, 32, .96); border: 1px solid rgba(190, 220, 235, .35); box-shadow: 0 10px 30px rgba(0, 0, 0, .55); color: #e6f1f5; font-size: .78rem; left: 0; max-width: 380px; min-width: 220px; opacity: 0; pointer-events: none; position: fixed; top: 0; z-index: 1000; }
    .tip.ready { opacity: 1; }
    .tip-title { background: linear-gradient(90deg, rgba(110, 125, 135, .55), rgba(60, 75, 85, .55)); color: #fff; font-size: .9rem; font-weight: 700; padding: 6px 12px; }
    .tip-badges { align-items: center; display: flex; gap: 10px; padding: 8px 12px 4px; }
    .tip-badge { align-items: center; background: #4a5a66; clip-path: polygon(0 0, calc(100% - 9px) 0, 100% 100%, 0 100%); color: #fff; display: inline-flex; font-size: .74rem; font-weight: 800; gap: 5px; padding: 3px 16px 3px 8px; }
    .tip-badge img { height: 15px; width: 15px; }
    .tip-badge[data-element="0"] { background: #8f7a68; } .tip-badge[data-element="1"] { background: #c04a2c; } .tip-badge[data-element="2"] { background: #2f7fd6; }
    .tip-badge[data-element="3"] { background: #b8961c; } .tip-badge[data-element="4"] { background: #5f9a2a; } .tip-badge[data-element="5"] { background: #5d3c8f; }
    .tip-badge[data-element="6"] { background: #7a3fb0; } .tip-badge[data-element="7"] { background: #a0642c; } .tip-badge[data-element="8"] { background: #3aa7c9; }
    .tip-stat { align-items: center; color: #c9d8df; display: inline-flex; font-size: .74rem; gap: 4px; margin-left: auto; }
    .tip-stat + .tip-stat { margin-left: 0; }
    .tip-stat b { color: #5ecbff; font-size: .86rem; }
    .tip-stat i { border: 1.5px solid #c9d8df; border-radius: 50%; display: inline-block; height: 10px; position: relative; width: 10px; }
    .tip-stat i[data-icon="clock"]::after { border-left: 1.5px solid #c9d8df; border-bottom: 1.5px solid #c9d8df; content: ''; height: 3px; left: 4px; position: absolute; top: 1px; width: 2px; }
    .tip-stat i[data-icon="power"] { border: 0; } .tip-stat i[data-icon="power"]::after { content: '✹'; font-size: 12px; font-style: normal; line-height: 10px; position: absolute; left: -1px; top: -1px; }
    .tip-rows { border-top: 1px solid rgba(190, 220, 235, .18); margin: 4px 12px 0; padding: 6px 0 2px; }
    .tip-row { display: flex; gap: 14px; justify-content: space-between; line-height: 1.5; }
    .tip-row span { color: #b9cbd4; } .tip-row b { color: #5ecbff; font-variant-numeric: tabular-nums; }
    .tip-row.total { border-top: 1px solid rgba(190, 220, 235, .18); margin-top: 3px; padding-top: 3px; } .tip-row.total b { color: #fff; }
    .tip-line { border-top: 1px solid rgba(190, 220, 235, .18); line-height: 1.45; margin: 6px 12px 0; padding: 7px 0 8px; }
    .tip-line + .tip-line { border-top: 0; margin-top: 0; padding-top: 0; }
    .tip-note { color: #ffd37a; font-size: .68rem; margin: 0 12px 8px; }
  `],
})
export class GameTooltipComponent {
  @Input({ required: true }) data!: TooltipData;
  x = 0;
  y = 0;
  ready = false;
}

@Directive({ selector: '[appTooltip]', standalone: true })
export class TooltipDirective implements OnDestroy {
  @Input('appTooltip') data: TooltipData | null = null;
  private ref: ComponentRef<GameTooltipComponent> | null = null;

  constructor(
    private readonly host: ElementRef<HTMLElement>,
    private readonly appRef: ApplicationRef,
    private readonly injector: EnvironmentInjector,
  ) {}

  @HostListener('mouseenter')
  @HostListener('focus')
  show(): void {
    if (!this.data || this.ref) return;
    const ref = createComponent(GameTooltipComponent, { environmentInjector: this.injector });
    ref.instance.data = this.data;
    this.appRef.attachView(ref.hostView);
    document.body.appendChild(ref.location.nativeElement);
    ref.changeDetectorRef.detectChanges();
    this.ref = ref;
    const tip = (ref.location.nativeElement as HTMLElement).querySelector('.tip') as HTMLElement;
    const anchor = this.host.nativeElement.getBoundingClientRect();
    const size = tip.getBoundingClientRect();
    const margin = 8;
    ref.instance.x = Math.max(margin, Math.min(anchor.left, window.innerWidth - size.width - margin));
    ref.instance.y = anchor.bottom + margin + size.height > window.innerHeight - margin && anchor.top - size.height - margin > 0
      ? anchor.top - size.height - margin
      : anchor.bottom + margin;
    ref.instance.ready = true;
    ref.changeDetectorRef.detectChanges();
  }

  @HostListener('mouseleave')
  @HostListener('blur')
  @HostListener('window:scroll')
  hide(): void {
    if (!this.ref) return;
    this.appRef.detachView(this.ref.hostView);
    this.ref.destroy();
    this.ref = null;
  }

  ngOnDestroy(): void { this.hide(); }
}
