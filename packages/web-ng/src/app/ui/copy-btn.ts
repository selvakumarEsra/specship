import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';
import { Icon } from '../shell/icon/icon';

/**
 * Copy-to-clipboard ghost button — flips to a green check for ~1.1s.
 * Mirrors design ui.jsx CopyBtn.
 */
@Component({
  selector: 'app-copy-btn',
  imports: [Icon],
  template: `<button
    type="button"
    class="btn btn-ghost btn-xs"
    title="Copy"
    [style.color]="done() ? 'var(--success)' : null"
    (click)="copy($event)"
  >
    <app-icon [name]="done() ? 'check' : 'copy'" [size]="12" />
    @if (label()) { {{ label() }} }
  </button>`,
  styles: [':host{display:inline-flex;}'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CopyBtn {
  readonly text = input<string>('');
  readonly label = input<string>('');
  protected readonly done = signal(false);

  protected copy(e: Event): void {
    e.stopPropagation();
    navigator.clipboard?.writeText(this.text());
    this.done.set(true);
    setTimeout(() => this.done.set(false), 1100);
  }
}
