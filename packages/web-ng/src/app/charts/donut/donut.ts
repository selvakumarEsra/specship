import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export interface DonutSlice { model?: string; short?: string; cost: number; color: string; }

interface SliceArc {
  d: string;
  color: string;
  label: string;
}

@Component({
  selector: 'app-donut',
  imports: [],
  templateUrl: './donut.html',
  styleUrl: './donut.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Donut {
  readonly data = input<DonutSlice[]>([]);
  readonly size = input<number>(150);
  readonly centerLabel = input<string>('');
  readonly centerSub = input<string>('');

  protected readonly arcs = computed<SliceArc[]>(() => {
    const d = this.data();
    const total = d.reduce((a, b) => a + b.cost, 0);
    if (total <= 0) return [];
    const s = this.size();
    const r = s / 2;
    const inner = r * 0.6;
    let start = -Math.PI / 2;
    const out: SliceArc[] = [];
    for (const slice of d) {
      const angle = (slice.cost / total) * Math.PI * 2;
      const end = start + angle;
      const large = angle > Math.PI ? 1 : 0;
      const x0 = r + Math.cos(start) * r;
      const y0 = r + Math.sin(start) * r;
      const x1 = r + Math.cos(end) * r;
      const y1 = r + Math.sin(end) * r;
      const ix0 = r + Math.cos(end) * inner;
      const iy0 = r + Math.sin(end) * inner;
      const ix1 = r + Math.cos(start) * inner;
      const iy1 = r + Math.sin(start) * inner;
      out.push({
        d: `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} L ${ix0} ${iy0} A ${inner} ${inner} 0 ${large} 0 ${ix1} ${iy1} Z`,
        color: slice.color,
        label: slice.short || slice.model || '',
      });
      start = end;
    }
    return out;
  });
}
