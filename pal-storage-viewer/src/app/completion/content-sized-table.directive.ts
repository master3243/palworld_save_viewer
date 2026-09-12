import { AfterViewInit, Directive, ElementRef, Input, NgZone, OnChanges, OnDestroy } from '@angular/core';
import { SizingColumn } from './table-sizing-model';

@Directive({ selector: 'table[contentSizedTable]', standalone: true })
export class ContentSizedTableDirective implements AfterViewInit, OnChanges, OnDestroy {
  private static readonly measured = new WeakMap<SizingColumn[], Map<string, number[]>>();
  @Input({ required: true }) contentSizedTable!: Promise<SizingColumn[]>;
  private ready = false;
  private version = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private readonly resize = () => {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.measure(), 100);
  };

  constructor(private readonly element: ElementRef<HTMLTableElement>, private readonly zone: NgZone) {}

  ngAfterViewInit(): void {
    this.ready = true;
    this.zone.runOutsideAngular(() => {
      window.addEventListener('resize', this.resize);
      void this.measure();
      if (document.fonts.status !== 'loaded') void document.fonts.ready.then(() => { if (this.ready) void this.measure(); });
    });
  }

  ngOnChanges(): void {
    if (this.ready) this.zone.runOutsideAngular(() => void this.measure());
  }

  private async measure(): Promise<void> {
    const version = ++this.version;
    const columns = await this.contentSizedTable;
    if (!this.ready || version !== this.version) return;
    const table = this.element.nativeElement;
    const headers = Array.from(table.tHead?.rows[0]?.cells ?? []);
    if (headers.length !== columns.length) return;
    const styleKey = `${table.className}:${window.innerWidth}:${document.fonts.status}`;
    let measurements = ContentSizedTableDirective.measured.get(columns);
    const cached = measurements?.get(styleKey);
    if (cached) {
      this.applyWidths(headers, cached);
      return;
    }
    const probe = table.cloneNode(false) as HTMLTableElement;
    probe.classList.add('sizing-table');
    probe.removeAttribute('id');
    probe.setAttribute('aria-hidden', 'true');
    probe.inert = true;
    const head = table.tHead!.cloneNode(true) as HTMLTableSectionElement;
    for (const cell of Array.from(head.rows[0].cells)) cell.style.removeProperty('width');
    probe.appendChild(head);
    const row = probe.createTBody().insertRow();
    for (const column of columns) {
      const cell = row.insertCell();
      cell.className = column.className;
      // Values are escaped by trackerSizingColumns; no image URLs or live controls are loaded.
      cell.innerHTML = column.values.map(value => `<div class="sizing-value">${value}</div>`).join('');
    }
    // Preserve Angular's scoped styles on the lightweight value copies.
    const scope = table.getAttributeNames().filter(name => name.startsWith('_ngcontent-'));
    for (const node of Array.from(probe.querySelectorAll('*'))) for (const name of scope) node.setAttribute(name, '');
    table.parentElement!.appendChild(probe);
    const widths = Array.from(head.rows[0].cells, cell => Math.ceil(cell.getBoundingClientRect().width));
    probe.remove();
    if (!measurements) ContentSizedTableDirective.measured.set(columns, measurements = new Map());
    measurements.set(styleKey, widths);
    this.applyWidths(headers, widths);
  }

  private applyWidths(headers: HTMLTableCellElement[], widths: number[]): void {
    headers.forEach((header, index) => header.style.width = `${widths[index]}px`);
    this.element.nativeElement.style.setProperty('--table-content-width', `${widths.reduce((sum, width) => sum + width, 0)}px`);
  }

  ngOnDestroy(): void {
    this.ready = false;
    this.version++;
    clearTimeout(this.timer);
    window.removeEventListener('resize', this.resize);
  }
}
