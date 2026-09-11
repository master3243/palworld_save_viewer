import { Directive, ElementRef, Injectable, Input, NgZone, OnChanges, OnDestroy } from '@angular/core';
import { OfflineImageService } from './offline-image.service';

@Injectable({ providedIn: 'root' })
class ImageViewport {
  private observer?: IntersectionObserver;
  private readonly pending = new Map<Element, () => void>();

  constructor(private readonly zone: NgZone) {}

  observe(element: Element, load: () => void): () => void {
    this.zone.runOutsideAngular(() => {
      this.observer ??= new IntersectionObserver(entries => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const callback = this.pending.get(entry.target);
          this.pending.delete(entry.target);
          this.observer!.unobserve(entry.target);
          callback?.();
        }
      }, { rootMargin: '300px' });
      this.pending.set(element, load);
      this.observer.observe(element);
    });
    return () => {
      this.pending.delete(element);
      this.observer?.unobserve(element);
    };
  }
}

@Directive({ selector: 'img[offlineSrc]', standalone: true })
export class OfflineImageDirective implements OnChanges, OnDestroy {
  @Input() offlineSrc = '';
  private stop?: () => void;
  private version = 0;

  constructor(
    private readonly element: ElementRef<HTMLImageElement>,
    private readonly viewport: ImageViewport,
    private readonly images: OfflineImageService,
  ) {}

  ngOnChanges(): void {
    this.stop?.();
    const version = ++this.version;
    const image = this.element.nativeElement;
    image.removeAttribute('src');
    if (!this.offlineSrc) return;
    const path = this.offlineSrc;
    this.stop = this.viewport.observe(image, () => {
      // Keep decorative image fetches and updates outside Angular's table checks.
      void this.images.load(path).then(src => {
        if (version === this.version && src) image.src = src;
      });
    });
  }

  ngOnDestroy(): void {
    ++this.version;
    this.stop?.();
  }
}
