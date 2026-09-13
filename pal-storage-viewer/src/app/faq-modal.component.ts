import { AfterViewInit, Component, ElementRef, EventEmitter, Input, Output, ViewChild } from '@angular/core';

import { GithubIconComponent } from './github-icon.component';

/** The "?" help dialog: what the site is, what it reads, and where the code lives. */
@Component({
  selector: 'app-faq-modal',
  standalone: true,
  imports: [GithubIconComponent],
  templateUrl: './faq-modal.component.html',
  styleUrl: './faq-modal.component.css'
})
export class FaqModalComponent implements AfterViewInit {
  @Input() section: 'local-data-owner' | null = null;
  @ViewChild('localDataOwner') private localDataOwner!: ElementRef<HTMLDetailsElement>;
  @Output() readonly closed = new EventEmitter<void>();

  ngAfterViewInit(): void {
    if (this.section !== 'local-data-owner') return;
    const target = this.localDataOwner.nativeElement;
    target.querySelector('summary')?.focus({ preventScroll: true });
    const scroller = target.closest('.faq');
    if (scroller) scroller.scrollTop += target.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  }
}
