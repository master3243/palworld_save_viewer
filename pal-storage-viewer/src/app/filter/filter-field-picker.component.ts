import { CommonModule } from '@angular/common';
import { Component, ElementRef, EventEmitter, Input, OnDestroy, Output, ViewChild } from '@angular/core';
import type { FilterField } from './filter-model';

/** Shared field search for rule fields, comparison fields and formula operands. */
@Component({
  selector: 'app-filter-field-picker',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './filter-field-picker.component.html',
  styleUrl: './filter-field-picker.component.css'
})
export class FilterFieldPickerComponent implements OnDestroy {
  private static nextId = 0;
  readonly menuId = `filter-fields-${++FilterFieldPickerComponent.nextId}`;
  @Input() fields: FilterField[] = [];
  @Input() value = '';
  @Input() expression = false;
  @Input() label = 'Filter field';
  @Input() placeholder = 'Choose a field';
  @Input() hint = '';
  @Output() valueChange = new EventEmitter<string>();
  @ViewChild('input') input!: ElementRef<HTMLInputElement>;
  @ViewChild('menu') menu?: ElementRef<HTMLElement>;
  open = false;
  draft: string | null = null;
  sections: { name: string; fields: FilterField[] }[] = [];
  active: FilterField | null = null;
  above = false;
  menuHeight = 280;
  menuWidth = 300;
  private blurTimer?: ReturnType<typeof setTimeout>;
  private revealTimer?: ReturnType<typeof setTimeout>;

  ngOnDestroy(): void { clearTimeout(this.blurTimer); clearTimeout(this.revealTimer); }
  get selectedLabel(): string { return this.fields.find(field => field.key === this.value)?.label ?? this.value; }
  get display(): string { return this.expression ? this.value : this.draft ?? this.selectedLabel; }

  onFocus(): void {
    clearTimeout(this.blurTimer);
    if (this.expression) this.completeFormula();
    else { this.draft = ''; this.show(''); }
  }

  onInput(): void {
    const value = this.input.nativeElement.value;
    if (this.expression) { this.valueChange.emit(value); this.completeFormula(); }
    else { this.draft = value; this.show(value); }
  }

  onBlur(): void {
    this.blurTimer = setTimeout(() => { this.open = false; this.draft = null; }, 150);
  }

  toggle(): void {
    if (this.open) { this.open = false; this.draft = null; return; }
    this.input.nativeElement.focus({ preventScroll: true });
    if (!this.expression) this.draft = '';
    this.show('');
  }

  onCaret(): void { if (this.expression) this.completeFormula(); }

  private operand(): { start: number; end: number; prefix: string } | null {
    const input = this.input.nativeElement;
    const caret = input.selectionStart ?? input.value.length;
    const match = /(?:^|[^a-z0-9_])([a-z_]\w*)$/i.exec(input.value.slice(0, caret));
    if (!match) return null;
    return { start: caret - match[1].length, end: caret + (input.value.slice(caret).match(/^\w*/)?.[0].length ?? 0), prefix: match[1] };
  }

  private completeFormula(): void {
    const operand = this.operand();
    if (operand) this.show(operand.prefix); else this.open = false;
  }

  private show(text: string): void {
    const query = text.trim().toLowerCase();
    const groups = new Map<string, FilterField[]>();
    for (const field of this.fields) {
      if (query && ![field.label, field.key, ...field.aliases, field.hint ?? ''].some(value => value.toLowerCase().includes(query))) continue;
      const fields = groups.get(field.group) ?? [];
      fields.push(field); groups.set(field.group, fields);
    }
    this.sections = [...groups].map(([name, fields]) => ({ name, fields }));
    const fields = this.sections.flatMap(section => section.fields);
    this.active = query ? fields.find(field => field.key === query || field.label.toLowerCase().startsWith(query)) ?? fields[0] ?? null
      : fields.find(field => field.key === this.value) ?? null;
    const rect = this.input.nativeElement.getBoundingClientRect();
    const panel = this.input.nativeElement.closest('.filter-panel')?.getBoundingClientRect();
    const bottom = Math.min(window.innerHeight, panel?.bottom ?? window.innerHeight) - rect.bottom - 10;
    const top = rect.top - Math.max(0, panel?.top ?? 0) - 10;
    this.above = bottom < 180 && top > bottom;
    this.menuHeight = Math.min(280, Math.max(60, this.above ? top : bottom));
    this.menuWidth = Math.min(340, Math.max(rect.width, 280), (panel?.right ?? window.innerWidth) - rect.left - 10);
    this.open = true;
    this.revealActive();
  }

  private revealActive(): void {
    clearTimeout(this.revealTimer);
    this.revealTimer = setTimeout(() => {
      const menu = this.menu?.nativeElement;
      const selected = menu?.querySelector<HTMLElement>('.active');
      if (!menu || !selected) return;
      // Scroll only the option list. scrollIntoView also scrolls the filter panel and page.
      const bounds = menu.getBoundingClientRect(), item = selected.getBoundingClientRect();
      if (item.top < bounds.top) menu.scrollTop -= bounds.top - item.top;
      else if (item.bottom > bounds.bottom) menu.scrollTop += item.bottom - bounds.bottom;
    });
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') { this.open = false; this.draft = null; event.stopPropagation(); return; }
    if (event.key === 'Tab' && !this.expression && !this.draft) { this.open = false; this.draft = null; return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!this.open) { this.show(''); return; }
      const fields = this.sections.flatMap(section => section.fields);
      const index = this.active ? fields.indexOf(this.active) : -1;
      this.active = fields[(index + (event.key === 'ArrowDown' ? 1 : fields.length - 1)) % fields.length] ?? null;
      this.revealActive();
    } else if (this.open && this.active && (event.key === 'Enter' || event.key === 'Tab')) {
      this.pick(this.active); event.preventDefault();
    }
  }

  pick(field: FilterField): void {
    clearTimeout(this.blurTimer);
    const input = this.input.nativeElement;
    if (this.expression) {
      const operand = this.operand();
      const start = operand?.start ?? input.selectionStart ?? input.value.length;
      const end = operand?.end ?? input.selectionEnd ?? start;
      const value = input.value.slice(0, start) + field.key + input.value.slice(end);
      input.value = value;
      this.valueChange.emit(value);
      input.focus({ preventScroll: true });
      input.setSelectionRange(start + field.key.length, start + field.key.length);
    } else {
      this.valueChange.emit(field.key);
      input.focus({ preventScroll: true });
      this.draft = null;
    }
    this.open = false;
  }
}
