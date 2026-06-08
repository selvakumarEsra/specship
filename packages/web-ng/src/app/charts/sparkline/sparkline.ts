import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

@Component({
  selector: 'app-sparkline',
  imports: [],
  templateUrl: './sparkline.html',
  styleUrl: './sparkline.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Sparkline {
  readonly data = input<number[]>([]);
  readonly color = input<string>('var(--accent)');
  readonly width = input<number>(80);
  readonly height = input<number>(24);
  readonly fill = input<boolean>(false);

  protected readonly pathD = computed(() => {
    const d = this.data();
    if (!d || d.length < 2) return '';
    const w = this.width(), h = this.height();
    const max = Math.max(...d), min = Math.min(...d);
    const range = max - min || 1;
    return d
      .map((v, i) => {
        const x = (i / (d.length - 1)) * w;
        const y = h - ((v - min) / range) * (h - 4) - 2;
        return (i === 0 ? 'M' : 'L') + x.toFixed(2) + ' ' + y.toFixed(2);
      })
      .join(' ');
  });

  protected readonly fillD = computed(() => {
    const p = this.pathD();
    if (!p) return '';
    return p + ` L ${this.width()} ${this.height()} L 0 ${this.height()} Z`;
  });
}
