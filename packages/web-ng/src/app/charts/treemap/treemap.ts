/**
 * Treemap — squarified (Bruls et al.) layout. Area encodes `value`, fill
 * intensity encodes `intensity` (0..1, e.g. tokens-per-call). Ported 1:1 from
 * the SpecShip Desktop design (charts.jsx Treemap + squarifyLayout).
 *
 * Pure presentational: the owning page maps its data into TreemapItem[] and
 * handles (pick).
 */
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  computed,
  input,
  output,
  signal,
} from '@angular/core';

export interface TreemapItem {
  key: string;
  label: string;
  value: number;
  /** 0..1 — drives fill warmth. */
  intensity?: number;
  sub?: string;
  title?: string;
}

interface Cell extends TreemapItem {
  x: number;
  y: number;
  w: number;
  h: number;
}

@Component({
  selector: 'app-treemap',
  imports: [],
  template: `<div class="tm" [class.detailed]="variant() === 'detailed'" [style.height.px]="height()">
    @for (c of cells(); track c.key) {
      <div
        class="tm-cell"
        [class.sel]="c.key === selKey()"
        [class.big]="isBig(c)"
        [style.left.px]="c.x + 1.5"
        [style.top.px]="c.y + 1.5"
        [style.width.px]="cellW(c)"
        [style.height.px]="cellH(c)"
        [style.background]="cellBg(c)"
        [title]="c.title || c.label"
        (click)="pick.emit(c.key)"
      >
        @if (isMid(c)) {
          <span
            class="mono tm-label"
            [style.font-size.px]="labelFont(c)"
            [style.color]="textColor(c)"
          >{{ c.label }}</span>
        }
        @if (isBig(c) && c.sub) {
          <span
            class="mono tabular tm-sub"
            [style.color]="subColor(c)"
          >{{ c.sub }}</span>
        }
      </div>
    }
  </div>`,
  styles: [`
    :host { display: block; }
    .tm { position: relative; width: 100%; border-radius: 7px; overflow: hidden; background: var(--bg-canvas); }
    .tm.detailed { border-radius: 8px; }
    .tm-cell {
      position: absolute; border-radius: 4px; overflow: hidden;
      cursor: pointer; display: flex; flex-direction: column; justify-content: center;
      padding: 0 5px; border: 1px solid rgba(0,0,0,0.26);
    }
    .tm-cell.big { padding: 5px 7px; justify-content: flex-start; }
    .tm-cell.sel { border: 1.5px solid var(--accent); }
    .tm-label { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 1.25; }
    .tm-sub { font-size: 9px; margin-top: 1px; }

    /* Detailed variant — the Heatmap page's FileTreemap (larger cells + selection glow). */
    .tm.detailed .tm-cell { border-radius: 5px; padding: 0 6px; border-color: rgba(0,0,0,0.28); }
    .tm.detailed .tm-cell.big { padding: 7px 9px; }
    .tm.detailed .tm-cell.sel { box-shadow: 0 0 0 3px var(--accent-soft); transition: box-shadow 100ms; }
    .tm.detailed .tm-label { line-height: 1.3; }
    .tm.detailed .tm-sub { font-size: 10px; margin-top: 2px; }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Treemap implements AfterViewInit, OnDestroy {
  readonly items = input<TreemapItem[]>([]);
  readonly height = input<number>(120);
  readonly selKey = input<string | null>(null);
  /** 'compact' = dashboard heatstrip (charts.jsx Treemap); 'detailed' = Heatmap page FileTreemap. */
  readonly variant = input<'compact' | 'detailed'>('compact');
  readonly pick = output<string>();

  private readonly width = signal(0);
  private ro?: ResizeObserver;

  constructor(private readonly hostEl: ElementRef<HTMLElement>) {}

  ngAfterViewInit(): void {
    if (typeof ResizeObserver === 'undefined') {
      this.width.set(this.hostEl.nativeElement.clientWidth || 600);
      return;
    }
    this.ro = new ResizeObserver((es) => this.width.set(es[0].contentRect.width));
    this.ro.observe(this.hostEl.nativeElement);
  }

  ngOnDestroy(): void {
    this.ro?.disconnect();
  }

  protected readonly cells = computed<Cell[]>(() => {
    const W = this.width() || 600;
    const H = this.height();
    const sorted = [...this.items()].sort((a, b) => b.value - a.value);
    return squarifyLayout(sorted, 0, 0, W, H);
  });

  protected cellW(c: Cell): number { return Math.max(0, c.w - 3); }
  protected cellH(c: Cell): number { return Math.max(0, c.h - 3); }

  private detailed(): boolean { return this.variant() === 'detailed'; }
  protected isBig(c: Cell): boolean {
    return this.detailed() ? c.w > 58 && c.h > 30 : c.w > 52 && c.h > 26;
  }
  protected isMid(c: Cell): boolean {
    return this.detailed() ? c.w > 40 && c.h > 18 : c.w > 36 && c.h > 15;
  }
  protected labelFont(c: Cell): number {
    if (this.detailed()) return this.isBig(c) ? 11 : 9.5;
    return this.isBig(c) ? 10 : 9;
  }

  private warm(c: Cell): string {
    const t = this.t(c);
    return t > 0.66 ? 'var(--error)' : t > 0.33 ? 'var(--warn)' : 'var(--node-route)';
  }
  private t(c: Cell): number { return Math.max(0, Math.min(1, c.intensity || 0)); }

  protected cellBg(c: Cell): string {
    const pct = Math.round(20 + this.t(c) * (this.detailed() ? 60 : 58));
    return `color-mix(in srgb, ${this.warm(c)} ${pct}%, var(--bg-elevated))`;
  }
  protected textColor(c: Cell): string {
    return this.t(c) > 0.45 ? '#fff' : 'var(--text-primary)';
  }
  protected subColor(c: Cell): string {
    return this.t(c) > 0.45 ? 'rgba(255,255,255,0.8)' : 'var(--text-muted)';
  }
}

interface SqItem { d: TreemapItem; area: number; }

export function squarifyLayout(data: TreemapItem[], X: number, Y: number, W: number, H: number): Cell[] {
  const total = data.reduce((a, b) => a + b.value, 0) || 1;
  const items: SqItem[] = data.map((d) => ({ d, area: (d.value / total) * (W * H) }));
  const res: Cell[] = [];
  let rect = { x: X, y: Y, w: W, h: H };
  let row: SqItem[] = [];
  const sum = (arr: SqItem[]) => arr.reduce((a, b) => a + b.area, 0);
  const worst = (arr: SqItem[], len: number) => {
    if (!arr.length) return Infinity;
    const s = sum(arr);
    const mx = Math.max(...arr.map((a) => a.area));
    const mn = Math.min(...arr.map((a) => a.area));
    return Math.max((len * len * mx) / (s * s), (s * s) / (len * len * mn));
  };
  const flush = () => {
    const len = Math.min(rect.w, rect.h);
    const s = sum(row);
    const thick = s / (len || 1);
    let off = 0;
    const horizontal = rect.w >= rect.h;
    row.forEach((it) => {
      const cl = it.area / (thick || 1);
      if (horizontal) res.push({ ...it.d, x: rect.x, y: rect.y + off, w: thick, h: cl });
      else res.push({ ...it.d, x: rect.x + off, y: rect.y, w: cl, h: thick });
      off += cl;
    });
    if (horizontal) rect = { x: rect.x + thick, y: rect.y, w: rect.w - thick, h: rect.h };
    else rect = { x: rect.x, y: rect.y + thick, w: rect.w, h: rect.h - thick };
    row = [];
  };
  items.forEach((it) => {
    const len = Math.min(rect.w, rect.h);
    if (row.length && worst([...row, it], len) > worst(row, len)) flush();
    row.push(it);
  });
  if (row.length) flush();
  return res;
}
