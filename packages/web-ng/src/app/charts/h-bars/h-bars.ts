import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

export interface HBarItem {
  name: string;
  calls?: number;
  tokens?: number;
  // arbitrary extra
  [k: string]: unknown;
}

@Component({
  selector: 'app-h-bars',
  imports: [],
  templateUrl: './h-bars.html',
  styleUrl: './h-bars.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HBars {
  readonly items = input<HBarItem[]>([]);
  readonly valueKey = input<'calls' | 'tokens'>('calls');
  readonly selectedKey = input<string | null>(null);
  readonly color = input<string | ((it: HBarItem) => string)>('var(--accent)');
  readonly fmt = input<(v: number) => string>((v) => String(v));
  readonly itemClick = output<HBarItem>();

  protected readonly max = computed(() => {
    const items = this.items();
    return Math.max(0.0001, ...items.map((it) => Number(it[this.valueKey()] ?? 0)));
  });

  protected barColor(it: HBarItem): string {
    const c = this.color();
    return typeof c === 'function' ? c(it) : c;
  }

  protected width(it: HBarItem): number {
    return (Number(it[this.valueKey()] ?? 0) / this.max()) * 100;
  }

  protected value(it: HBarItem): number {
    return Number(it[this.valueKey()] ?? 0);
  }

  protected fmtValue(it: HBarItem): string {
    return this.fmt()(this.value(it));
  }

  protected onClick(it: HBarItem): void {
    this.itemClick.emit(it);
  }
}
