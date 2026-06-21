import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * Mini horizontal progress bar (cost rows, per-node cost, etc.).
 * Mirrors design ui.jsx Bar.
 */
@Component({
  selector: 'app-bar',
  imports: [],
  template: `<div
    class="bar-track"
    [style.height.px]="height()"
  >
    <div
      class="bar-fill"
      [style.width.%]="pct()"
      [style.background]="color() || 'var(--accent)'"
    ></div>
  </div>`,
  styles: [`
    :host { display: block; }
    .bar-track { background: rgba(255,255,255,0.06); border-radius: 999px; overflow: hidden; width: 100%; }
    .bar-fill { height: 100%; border-radius: 999px; }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Bar {
  readonly frac = input<number>(0);
  readonly color = input<string>('');
  readonly height = input<number>(4);

  protected readonly pct = computed(() => Math.max(2, this.frac() * 100));
}
