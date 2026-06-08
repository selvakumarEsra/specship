import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

export interface LinePoint { day: number; cost: number; prompts: number; }

@Component({
  selector: 'app-line-chart',
  imports: [],
  templateUrl: './line-chart.html',
  styleUrl: './line-chart.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LineChart {
  readonly series = input<LinePoint[]>([]);
  readonly color = input<string>('var(--accent)');
  readonly height = input<number>(200);
  readonly hover = output<LinePoint | null>();

  protected readonly width = 600;

  protected readonly stats = computed(() => {
    const s = this.series();
    if (!s.length) return { max: 1, min: 0 };
    const costs = s.map((p) => p.cost);
    return { max: Math.max(...costs, 0.01), min: 0 };
  });

  protected readonly pathD = computed(() => {
    const s = this.series();
    if (!s.length) return '';
    const w = this.width, h = this.height();
    const { max } = this.stats();
    return s
      .map((p, i) => {
        const x = (i / Math.max(1, s.length - 1)) * w;
        const y = h - (p.cost / max) * (h - 20) - 10;
        return (i === 0 ? 'M' : 'L') + x.toFixed(2) + ' ' + y.toFixed(2);
      })
      .join(' ');
  });

  protected readonly fillD = computed(() => {
    const p = this.pathD();
    if (!p) return '';
    return p + ` L ${this.width} ${this.height()} L 0 ${this.height()} Z`;
  });

  protected onLeave(): void { this.hover.emit(null); }

  protected onMove(ev: MouseEvent): void {
    const svg = ev.currentTarget as SVGElement;
    const rect = svg.getBoundingClientRect();
    const xPct = (ev.clientX - rect.left) / rect.width;
    const s = this.series();
    if (!s.length) return;
    const idx = Math.min(s.length - 1, Math.max(0, Math.round(xPct * (s.length - 1))));
    const point = s[idx];
    if (point) this.hover.emit(point);
  }
}
