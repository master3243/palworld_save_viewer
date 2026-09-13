import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AfterViewInit, Component, ElementRef, EventEmitter, Input, OnInit, Output, ViewChild } from '@angular/core';
import { DEFAULT_DEMO, DemoSave, loadDemoCatalog } from './demo-catalog';
import { formatSize } from './save-file-labels';

@Component({
  selector: 'app-demo-picker', standalone: true, imports: [CommonModule, FormsModule],
  templateUrl: './demo-picker.component.html', styleUrl: './demo-picker.component.css',
})
export class DemoPickerComponent implements OnInit, AfterViewInit {
  @Input({ required: true }) current!: DemoSave;
  @Input() busy = false;
  @Input() downloadError = '';
  @Output() readonly cancel = new EventEmitter<void>();
  @Output() readonly choose = new EventEmitter<DemoSave>();
  @ViewChild('pickerTitle') private pickerTitle!: ElementRef<HTMLElement>;
  demos: DemoSave[] = [];
  selectedId = '';
  loading = true;
  error = '';
  readonly formatSize = formatSize;

  ngOnInit(): void { this.selectedId = this.current.id; void this.load(); }
  ngAfterViewInit(): void { this.pickerTitle.nativeElement.focus(); }
  async load(): Promise<void> {
    this.loading = true;
    this.error = '';
    try {
      this.demos = [...await loadDemoCatalog()].sort((a, b) => {
        if (a.id === DEFAULT_DEMO.id) return -1;
        if (b.id === DEFAULT_DEMO.id) return 1;
        return (b.summary.percent ?? -1) - (a.summary.percent ?? -1);
      });
    }
    catch (error) { this.error = error instanceof Error ? error.message : 'Could not load demos.'; }
    finally { this.loading = false; }
  }
  get selection(): DemoSave | undefined { return this.demos.find(demo => demo.id === this.selectedId); }
  select(demo: DemoSave): void { if (!this.busy) this.selectedId = demo.id; }
  sourceName(url: string): string {
    const name = new URL(url).hostname.replace(/^www\./, '').replace(/\.[^.]+$/, '');
    const labels: Record<string, string> = { github: 'GitHub', nexusmods: 'Nexus Mods' };
    return labels[name] ?? name.charAt(0).toUpperCase() + name.slice(1);
  }
  confirm(): void { if (this.selection && !this.busy) this.choose.emit(this.selection); }
  trackDemo(_index: number, demo: DemoSave): string { return demo.id; }
}
