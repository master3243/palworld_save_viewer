import { AfterViewInit, Directive, ElementRef, EventEmitter, Input, NgZone, OnDestroy, Output } from '@angular/core';

@Directive({ selector: 'table[stickyTableHeader]', standalone: true })
export class StickyTableHeaderDirective implements AfterViewInit, OnDestroy {
  @Input({ required: true }) stickyTableHeader!: HTMLElement;
  @Output() stickyHeaderChange = new EventEmitter<boolean>();
  private observer?: IntersectionObserver;
  private pinned?: boolean;
  private destroyed = false;

  constructor(private readonly element: ElementRef<HTMLTableElement>, private readonly zone: NgZone) {}

  ngAfterViewInit(): void {
    const marker = this.element.nativeElement.caption;
    if (!marker) return;
    this.zone.runOutsideAngular(() => {
      // CSS pins the header; this observer only controls the back-to-top button.
      this.observer = new IntersectionObserver(() => {
        if (this.destroyed) return;
        const pinned = marker.getBoundingClientRect().bottom <= this.stickyTableHeader.getBoundingClientRect().top;
        if (pinned !== this.pinned) {
          this.pinned = pinned;
          this.zone.run(() => this.stickyHeaderChange.emit(pinned));
        }
      }, { root: this.stickyTableHeader });
      this.observer.observe(marker);
      // A large scroll jump can skip the marker while bringing the table into view.
      this.observer.observe(this.element.nativeElement);
    });
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.observer?.disconnect();
  }
}
