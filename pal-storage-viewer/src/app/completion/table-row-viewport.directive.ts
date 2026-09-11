import { ChangeDetectorRef, Directive, ElementRef, EmbeddedViewRef, Injectable, Input, NgZone, OnChanges, OnDestroy, TemplateRef, ViewContainerRef } from '@angular/core';

type VisibilityCallback = (visible: boolean, height?: number) => void;

@Injectable({ providedIn: 'root' })
export class TableRowViewport {
  private readonly rows = new WeakMap<Element, VisibilityCallback>();
  private readonly roots = new Map<HTMLElement, { observer: IntersectionObserver; callbacks: Map<Element, VisibilityCallback>; focus: (event: FocusEvent) => void }>();

  constructor(private readonly zone: NgZone) {}

  observe(root: HTMLElement, row: HTMLElement, callback: VisibilityCallback): () => void {
    let viewport = this.roots.get(root);
    if (!viewport) {
      const callbacks = new Map<Element, VisibilityCallback>();
      const observer = this.zone.runOutsideAngular(() => new IntersectionObserver(entries => {
        this.zone.run(() => {
          for (const entry of entries) callbacks.get(entry.target)?.(entry.isIntersecting, entry.boundingClientRect.height);
        });
      }, { root, rootMargin: '400px 0px' }));
      const focus = (event: FocusEvent) => {
        const row = (event.target as Element).closest<HTMLElement>('tr[data-item-id]');
        if (row) this.reveal(row);
      };
      root.addEventListener('focusin', focus);
      viewport = { observer, callbacks, focus };
      this.roots.set(root, viewport);
    }
    viewport.callbacks.set(row, callback);
    this.rows.set(row, callback);
    viewport.observer.observe(row);
    return () => {
      this.rows.delete(row);
      viewport.callbacks.delete(row);
      viewport.observer.unobserve(row);
      if (!viewport.callbacks.size) {
        viewport.observer.disconnect();
        root.removeEventListener('focusin', viewport.focus);
        this.roots.delete(root);
      }
    };
  }

  reveal(row: HTMLElement): void { this.rows.get(row)?.(true); }
}

/** Keep lightweight table rows for scrolling; create their cells only near the viewport. */
@Directive({ selector: '[tableRowViewport]', standalone: true })
export class TableRowViewportDirective implements OnChanges, OnDestroy {
  @Input({ required: true }) tableRowViewport!: HTMLElement;
  @Input({ required: true }) tableRowViewportColumns!: number;
  @Input() tableRowViewportHeight = 36;
  private view?: EmbeddedViewRef<unknown>;
  private row?: HTMLElement;
  private placeholder?: HTMLTableCellElement;
  private stop?: () => void;

  constructor(
    private readonly element: ElementRef<Comment>,
    private readonly template: TemplateRef<unknown>,
    private readonly container: ViewContainerRef,
    private readonly viewport: TableRowViewport,
    private readonly changeDetector: ChangeDetectorRef,
  ) {}

  ngOnChanges(): void {
    this.stop?.();
    this.row = this.element.nativeElement.parentElement!;
    this.placeholder ??= document.createElement('td');
    this.placeholder.className = 'row-placeholder';
    this.placeholder.colSpan = this.tableRowViewportColumns;
    this.placeholder.style.cssText = `height:${this.tableRowViewportHeight}px;padding:0;border:0;`;
    if (!this.view) {
      this.row.appendChild(this.placeholder);
      this.row.setAttribute('aria-hidden', 'true');
    }
    this.stop = this.viewport.observe(this.tableRowViewport, this.row, (visible, height) => this.update(visible, height));
  }

  private update(visible: boolean, height?: number): void {
    const row = this.row!;
    if (visible && !this.view) {
      this.placeholder!.remove();
      row.removeAttribute('aria-hidden');
      this.view = this.container.createEmbeddedView(this.template);
      this.view.detectChanges();
      this.changeDetector.markForCheck();
    } else if (!visible && this.view) {
      // Preserve an expanded recipe or keyboard focus when its row scrolls off screen.
      if (row.contains(document.activeElement) || row.querySelector('details[open]')) return;
      this.placeholder!.style.height = `${height ?? row.offsetHeight}px`;
      this.container.clear();
      this.view = undefined;
      row.appendChild(this.placeholder!);
      row.setAttribute('aria-hidden', 'true');
    }
  }

  ngOnDestroy(): void { this.stop?.(); }
}
