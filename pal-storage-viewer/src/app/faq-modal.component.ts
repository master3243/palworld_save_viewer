import { Component, EventEmitter, Output } from '@angular/core';

/** The "?" help dialog: what the site is, what it reads, and where the code lives. */
@Component({
  selector: 'app-faq-modal',
  standalone: true,
  templateUrl: './faq-modal.component.html',
  styleUrl: './faq-modal.component.css'
})
export class FaqModalComponent {
  @Output() readonly closed = new EventEmitter<void>();
}
