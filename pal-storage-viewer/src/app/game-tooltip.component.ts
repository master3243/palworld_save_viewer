/**
 * Game-style hover card: a title bar, an optional element badge with clock/power figures, a table of
 * rows, and free text. `[appTooltip]` shows one for any element and removes it on leave/blur.
 */
import { CommonModule } from '@angular/common';
import {
  ApplicationRef, Component, ComponentRef, Directive, ElementRef, EnvironmentInjector, Input, NgZone, OnDestroy, OnInit, createComponent,
} from '@angular/core';

/** A run of tooltip text; `value` marks the part that changes with the skill level. */
export interface TextSegment { text: string; value: boolean; }
/** One partner-skill level in the tooltip's level list. */
export interface LevelLine { label: string; segments: TextSegment[]; current: boolean; }

/** One condensing rank of the work grid: filled stars and every suitability's level at that rank. */
export interface WorkLevelRow { stars: number; current: boolean; items: { src: string; name: string; rank: number; up: boolean; none: boolean }[]; }

export interface TooltipData {
  title: string;
  /** Figures shown right of the title, e.g. "687 ≫ 550". */
  titleRight?: string;
  /** Text shown first, before any rows. */
  intro?: string[];
  /** Element chip like the game's skill card (index into the element icon set). */
  badge?: { text: string; iconSrc?: string; element?: number };
  /** Figures shown right of the badge, e.g. cooldown and power. */
  stats?: { icon?: 'clock' | 'power'; label: string; value: string }[];
  /** Status effect line under the badge, like the game's "Aggregate: Burn   100". */
  effect?: { label: string; value: string };
  /** Label/value rows, e.g. a stat breakdown; a third item 'subtotal' draws a divider above the row. */
  rows?: [string, string, string?][];
  /** Work suitability at each condensing rank. */
  work?: WorkLevelRow[];
  /** 'host': the tooltip is as wide as the element it belongs to and lines up with its left edge. */
  fit?: 'host';
  /** Fixed width in px, so a family of tooltips (e.g. every active skill card) shares one size. */
  width?: number;
  /** Left-aligned lines with every figure marked, like the game's passive skill card ("Attack +30.0%"). */
  inline?: TextSegment[][];
  lines?: string[];
  /** Text with the level-driven parts marked, shown like an intro line. */
  rich?: TextSegment[];
  /** Partner skill values at every level, the Pal's current level marked. */
  levels?: LevelLine[];
  note?: string;
}

@Component({
  selector: 'app-game-tooltip',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="tip" [style.left.px]="x" [style.top.px]="y" [style.width.px]="width" [class.fitted]="width !== null" [class.ready]="ready">
      <div class="tip-title"><span>{{ data.title }}</span><b *ngIf="data.titleRight">{{ data.titleRight }}</b></div>
      <p class="tip-intro" *ngFor="let line of data.intro">{{ line }}</p>
      <p class="tip-intro tip-rich" *ngIf="data.rich?.length"><ng-container *ngFor="let seg of data.rich"><em *ngIf="seg.value; else richPlain">{{ seg.text }}</em><ng-template #richPlain>{{ seg.text }}</ng-template></ng-container></p>
      <div class="tip-badges" *ngIf="data.badge || data.stats?.length">
        <span class="tip-badge" *ngIf="data.badge" [attr.data-element]="data.badge.element">
          <img *ngIf="data.badge.iconSrc" [src]="data.badge.iconSrc" alt="">{{ data.badge.text }}
        </span>
        <span class="tip-stat" *ngFor="let stat of data.stats"><i [attr.data-icon]="stat.icon"></i>{{ stat.label }}<b>{{ stat.value }}</b></span>
      </div>
      <div class="tip-inline" *ngIf="data.inline?.length"><div *ngFor="let line of data.inline"><ng-container *ngFor="let seg of line"><em *ngIf="seg.value; else inlinePlain">{{ seg.text }}</em><ng-template #inlinePlain>{{ seg.text }}</ng-template></ng-container></div></div>
      <div class="tip-effect" *ngIf="data.effect as effect"><span>{{ effect.label }}</span><b>{{ effect.value }}</b></div>
      <div class="tip-rows" *ngIf="data.rows?.length">
        <div class="tip-row" *ngFor="let row of data.rows" [class.total]="row[0] === 'Total'" [class.subtotal]="row[2] === 'subtotal'"><span>{{ row[0] }}</span><b [class.negative]="row[1].startsWith('-')">{{ row[1] }}</b></div>
      </div>
      <div class="tip-work" *ngIf="data.work?.length">
        <div class="tip-work-row" *ngFor="let row of data.work" [class.current]="row.current">
          <span class="tip-stars"><i *ngFor="let slot of [0, 1, 2, 3]" [class.on]="slot < row.stars">★</i></span>
          <span class="tip-work-items" [style.grid-template-columns]="'repeat(' + row.items.length + ', minmax(0, 1fr))'"><span class="tip-work-item" *ngFor="let item of row.items" [class.up]="item.up" [class.none]="item.none" [title]="item.name"><img [src]="item.src" alt=""><b>{{ item.rank }}</b></span></span>
        </div>
      </div>
      <p class="tip-line" *ngFor="let line of data.lines">{{ line }}</p>
      <ol class="tip-levels" *ngIf="data.levels?.length">
        <li *ngFor="let level of data.levels" [class.current]="level.current"><span class="tip-level">{{ level.label }}</span><span class="tip-level-text"><ng-container *ngFor="let seg of level.segments"><em *ngIf="seg.value; else plain">{{ seg.text }}</em><ng-template #plain>{{ seg.text }}</ng-template></ng-container></span></li>
      </ol>
      <p class="tip-note" *ngIf="data.note">{{ data.note }}</p>
    </div>
  `,
  styles: [`
    .tip { background: rgba(14, 24, 32, .96); border: 1px solid rgba(190, 220, 235, .35); box-shadow: 0 10px 30px rgba(0, 0, 0, .55); color: #e6f1f5; font-size: .78rem; left: 0; max-width: 380px; min-width: 220px; opacity: 0; padding-bottom: 9px; pointer-events: none; position: fixed; top: 0; z-index: 1000; }
    .tip.ready { opacity: 1; }
    .tip.fitted { max-width: none; }
    .tip-title { align-items: center; background: linear-gradient(90deg, rgba(110, 125, 135, .55), rgba(60, 75, 85, .55)); color: #fff; display: flex; font-size: .9rem; font-weight: 700; gap: 16px; justify-content: space-between; padding: 6px 12px; }
    .tip-title b { font-variant-numeric: tabular-nums; font-weight: 700; white-space: nowrap; }
    .tip-intro { line-height: 1.45; margin: 8px 12px 0; }
    .tip-intro + .tip-intro { margin-top: 0; }
    .tip-intro + .tip-rows, .tip-intro + .tip-badges { border-top: 1px solid rgba(190, 220, 235, .18); margin-top: 8px; padding-top: 6px; }
    .tip-row b.negative { color: #ff5a5a; }
    .tip-badges { align-items: center; display: flex; gap: 10px; padding: 8px 12px 0; }
    .tip-badge { align-items: center; background: #4a5a66; clip-path: polygon(0 0, calc(100% - 9px) 0, 100% 100%, 0 100%); color: #fff; display: inline-flex; font-size: .74rem; font-weight: 800; gap: 5px; padding: 3px 16px 3px 8px; }
    .tip-badge img { height: 20px; width: 20px; }
    .tip-badge[data-element="0"] { background: #8f7a68; } .tip-badge[data-element="1"] { background: #c04a2c; } .tip-badge[data-element="2"] { background: #2f7fd6; }
    .tip-badge[data-element="3"] { background: #b8961c; } .tip-badge[data-element="4"] { background: #5f9a2a; } .tip-badge[data-element="5"] { background: #5d3c8f; }
    .tip-badge[data-element="6"] { background: #7a3fb0; } .tip-badge[data-element="7"] { background: #a0642c; } .tip-badge[data-element="8"] { background: #3aa7c9; }
    .tip-stat { align-items: center; color: #c9d8df; display: inline-flex; font-size: .74rem; gap: 4px; margin-left: auto; }
    .tip-stat + .tip-stat { margin-left: 0; }
    .tip-stat b { color: #5ecbff; font-size: .86rem; }
    .tip-stat i { border: 1.5px solid #c9d8df; border-radius: 50%; display: inline-block; height: 10px; position: relative; width: 10px; }
    .tip-stat i[data-icon="clock"]::after { border-left: 1.5px solid #c9d8df; border-bottom: 1.5px solid #c9d8df; content: ''; height: 3px; left: 4px; position: absolute; top: 1px; width: 2px; }
    .tip-stat i[data-icon="power"] { border: 0; } .tip-stat i[data-icon="power"]::after { content: '✹'; font-size: 12px; font-style: normal; line-height: 10px; position: absolute; left: -1px; top: -1px; }
    .tip-inline { line-height: 1.55; padding: 8px 12px 0; }
    .tip-inline em { color: #5ecbff; font-style: normal; font-variant-numeric: tabular-nums; font-weight: 600; }
    .tip-inline + .tip-line, .tip-inline + .tip-note { margin-top: 4px; }
    .tip-effect { background: rgba(255, 255, 255, .06); display: flex; justify-content: space-between; margin: 4px 0 0; padding: 4px 12px; }
    .tip-effect span { color: #c9d8df; } .tip-effect b { color: #fff; }
    .tip-rows { border-top: 1px solid rgba(190, 220, 235, .18); margin: 4px 12px 0; padding: 6px 0 0; }
    .tip-row { display: flex; gap: 14px; justify-content: space-between; line-height: 1.5; }
    .tip-row span { color: #b9cbd4; } .tip-row b { color: #5ecbff; font-variant-numeric: tabular-nums; }
    .tip-row.total { border-top: 1px solid rgba(190, 220, 235, .18); margin-top: 3px; padding-top: 3px; } .tip-row.total b { color: #fff; }
    .tip-row.subtotal { border-top: 1px solid rgba(190, 220, 235, .12); margin-top: 2px; padding-top: 2px; }
    .tip-work { border-top: 1px solid rgba(190, 220, 235, .18); margin: 6px 12px 0; padding: 6px 0 0; }
    .tip-work-row { align-items: center; border-left: 3px solid transparent; display: grid; gap: 10px; grid-template-columns: auto 1fr; margin-left: -12px; padding: 3px 0 3px 9px; }
    .tip-work-row.current { background: linear-gradient(90deg, rgba(255, 211, 122, .14), transparent); border-left-color: #ffd37a; }
    .tip-stars { display: inline-flex; font-size: .8rem; gap: 1px; letter-spacing: 0; }
    .tip-stars i { color: rgba(190, 220, 235, .25); font-style: normal; } .tip-stars i.on { color: #ffd37a; text-shadow: 0 0 5px rgba(255, 211, 122, .5); }
    .tip-work-items { display: grid; gap: 3px; }
    .tip-work-item { align-items: center; background: rgba(255, 255, 255, .05); border: 1px solid transparent; border-radius: 3px; color: #c9d8df; display: inline-flex; gap: 2px; justify-content: center; min-width: 0; padding: 1px 2px; }
    .tip-work-item img { height: 15px; width: 15px; } .tip-work-item b { font-size: .74rem; font-variant-numeric: tabular-nums; }
    .tip-work-item.none { opacity: .3; }
    .tip-work-item.up b { color: #ffe08a; }
    .tip-work-row.current .tip-work-item b { color: #fff; } .tip-work-row.current .tip-work-item.up b { color: #ffe08a; }
    .tip-line { border-top: 1px solid rgba(190, 220, 235, .18); line-height: 1.45; margin: 6px 12px 0; padding: 7px 0 0; }
    .tip-line + .tip-line { border-top: 0; margin-top: 0; padding-top: 0; }
    .tip-rich { line-height: 1.45; margin-bottom: 8px; }
    .tip-rich em { color: #ffe08a; font-style: normal; font-weight: 700; }
    .tip-levels { border-top: 1px solid rgba(190, 220, 235, .18); list-style: none; margin: 0 12px; padding: 6px 0 0; }
    .tip-levels li { border-left: 3px solid transparent; color: #a9bcc6; display: grid; gap: 10px; grid-template-columns: minmax(34px, max-content) 1fr; line-height: 1.4; padding: 2px 8px 2px 7px; }
    .tip-levels li.current { background: linear-gradient(90deg, rgba(255, 211, 122, .14), transparent); border-left-color: #ffd37a; color: #f2fbff; }
    .tip-level { color: #7fc9e6; font-size: .68rem; font-weight: 800; letter-spacing: .02em; padding-top: 1px; }
    .tip-levels li.current .tip-level { color: #ffd37a; }
    .tip-level-text { font-variant-numeric: tabular-nums; }
    .tip-level-text em { color: #ffe08a; font-style: normal; font-weight: 700; }
    .tip-levels li.current .tip-level-text em { text-shadow: 0 0 6px rgba(255, 211, 122, .45); }
    .tip-note { color: #ffd37a; font-size: .68rem; margin: 6px 12px 0; }
  `],
})
export class GameTooltipComponent {
  @Input({ required: true }) data!: TooltipData;
  x = 0;
  y = 0;
  /** Fixed width when the tooltip is fitted to its host. */
  width: number | null = null;
  ready = false;
}

@Directive({ selector: '[appTooltip]', standalone: true })
export class TooltipDirective implements OnInit, OnDestroy {
  @Input('appTooltip') data: TooltipData | null = null;
  private ref: ComponentRef<GameTooltipComponent> | null = null;
  private readonly show = () => this.open();
  private readonly hide = () => this.close();

  constructor(
    private readonly host: ElementRef<HTMLElement>,
    private readonly appRef: ApplicationRef,
    private readonly injector: EnvironmentInjector,
    private readonly zone: NgZone,
  ) {}

  ngOnInit(): void {
    // Registered outside the zone: hovering a chip must not run change detection over the whole
    // table. The tooltip component is checked by hand below.
    this.zone.runOutsideAngular(() => {
      const el = this.host.nativeElement;
      el.addEventListener('mouseenter', this.show);
      el.addEventListener('focus', this.show);
      el.addEventListener('mouseleave', this.hide);
      el.addEventListener('blur', this.hide);
      window.addEventListener('scroll', this.hide, true);
    });
  }

  private open(): void {
    if (!this.data || this.ref) return;
    const ref = createComponent(GameTooltipComponent, { environmentInjector: this.injector });
    ref.instance.data = this.data;
    const anchor = this.host.nativeElement.getBoundingClientRect();
    if (this.data.fit === 'host') ref.instance.width = Math.round(anchor.width);
    else if (this.data.width) ref.instance.width = this.data.width;
    this.appRef.attachView(ref.hostView);
    document.body.appendChild(ref.location.nativeElement);
    ref.changeDetectorRef.detectChanges();
    this.ref = ref;
    const tip = (ref.location.nativeElement as HTMLElement).querySelector('.tip') as HTMLElement;
    const size = tip.getBoundingClientRect();
    const margin = 8;
    ref.instance.x = Math.max(margin, Math.min(anchor.left, window.innerWidth - size.width - margin));
    ref.instance.y = anchor.bottom + margin + size.height > window.innerHeight - margin && anchor.top - size.height - margin > 0
      ? anchor.top - size.height - margin
      : anchor.bottom + margin;
    ref.instance.ready = true;
    ref.changeDetectorRef.detectChanges();
  }

  private close(): void {
    if (!this.ref) return;
    this.appRef.detachView(this.ref.hostView);
    this.ref.destroy();
    this.ref = null;
  }

  ngOnDestroy(): void {
    const el = this.host.nativeElement;
    el.removeEventListener('mouseenter', this.show);
    el.removeEventListener('focus', this.show);
    el.removeEventListener('mouseleave', this.hide);
    el.removeEventListener('blur', this.hide);
    window.removeEventListener('scroll', this.hide, true);
    this.close();
  }
}
