import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { Icon } from '../shell/icon/icon';

/**
 * Delta indicator — trend arrow + signed percent, green for "good".
 *
 * Contract (REQ-DASHINT-002): `value` is always a signed FRACTION of change
 * (0.55 → +55%, -1 → -100%, 2.37 → +237%). Every finite magnitude renders
 * as a percentage — the old `|v| < 1` heuristic leaked raw floats like
 * `-1` and `2.372016052719695` into stat tiles. Ratios ≥ 10× render in
 * multiplier form (+×12) to stay legible; non-finite values render as an
 * em dash.
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
    if (!Number.isFinite(v)) return '—';
    const abs = Math.abs(v);
    const body = abs >= 10 ? '×' + Math.round(abs) : Math.round(abs * 100) + '%';
    return (v < 0 ? '-' : '+') + body + this.suffix();
  });
}
