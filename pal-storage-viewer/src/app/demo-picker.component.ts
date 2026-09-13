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
  @ViewChild('searchInput') private searchInput!: ElementRef<HTMLInputElement>;
  demos: DemoSave[] = [];
  selectedId = '';
  search = '';
  loading = true;
  error = '';
  readonly formatSize = formatSize;

  ngOnInit(): void { this.selectedId = this.current.id; void this.load(); }
  ngAfterViewInit(): void { this.searchInput.nativeElement.focus(); }
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
  get visibleDemos(): DemoSave[] {
    const search = this.search.trim().toLowerCase();
    return this.demos.filter(demo => `${demo.name} ${demo.author ?? ''} ${demo.description}`.toLowerCase().includes(search));
  }
  get selection(): DemoSave | undefined { return this.demos.find(demo => demo.id === this.selectedId); }
  confirm(): void { if (this.selection && !this.busy) this.choose.emit(this.selection); }
  trackDemo(_index: number, demo: DemoSave): string { return demo.id; }
}
