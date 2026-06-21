import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Generic pill — coloured chip with optional leading dot and projected content.
 * Mirrors design ui.jsx Pill.
 */
@Component({
  selector: 'app-pill',
  imports: [],
  template: `<span
    class="pill"
    [style.color]="color() || 'var(--text-secondary)'"
    [style.background]="bg() || 'rgba(255,255,255,0.05)'"
  >
    @if (dot()) {
      <span class="pill-dot" [style.background]="color()"></span>
    }
    <ng-content />
  </span>`,
  styles: [':host{display:inline-flex;}'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Pill {
  readonly color = input<string>('');
  readonly bg = input<string>('');
  readonly dot = input(false);
}
