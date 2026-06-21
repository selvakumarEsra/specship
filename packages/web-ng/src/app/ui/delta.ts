import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { Icon } from '../shell/icon/icon';

/**
 * Delta indicator — trend arrow + signed value/percent, green for "good".
 * Mirrors design ui.jsx Delta. Values with |v| < 1 render as a percentage.
 */
@Component({
  selector: 'app-delta',
  imports: [Icon],
  template: `<span
    class="row gap-2 tabular"
    [style.color]="good() ? 'var(--success)' : 'var(--error)'"
    style="font-size: var(--fs-xs); font-weight: 600;"
  >
    <app-icon [name]="up() ? 'trendUp' : 'trendDown'" [size]="12" />
    {{ text() }}
  </span>`,
  styles: [':host{display:inline-flex;}'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Delta {
  readonly value = input.required<number>();
  readonly suffix = input<string>('');
  readonly invert = input(false);

  protected readonly up = computed(() => this.value() >= 0);
  protected readonly good = computed(() => (this.invert() ? !this.up() : this.up()));
  protected readonly text = computed(() => {
    const v = this.value();
    const body = Math.abs(v) < 1 && v !== 0 ? Math.round(v * 100) + '%' : String(v);
    return (this.up() ? '+' : '') + body + this.suffix();
  });
}
