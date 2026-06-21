/**
 * GraphCanvas — pan/zoom/drag SVG graph renderer.
 *
 * Pure presentational component. Receives a positioned node list + edge list
 * via inputs, emits a (nodeClick) when the user picks a node. The owning
 * page is responsible for fetching, laying out and selection.
 *
 * NEW optional inputs (backward-compatible additions):
 *   hiddenIds  — Set<string>: node ids to render at 0.2 opacity (filtered by parent)
 *   interactive — boolean (default true): show zoom controls + enable pan/drag
 *   dotGrid     — boolean (default true): show dot-grid background
 */
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { Icon } from '../../shell/icon/icon';

export type GraphNodeKind = 'function' | 'method' | 'class' | 'spec' | 'route' | 'file' | string;

export interface CanvasNode {
  id: string;
  label: string;
  sub?: string;
  kind: GraphNodeKind;
  state?: 'verified' | 'drifted' | 'broken' | 'orphaned' | string | null;
  x: number;
  y: number;
}

export interface CanvasEdge {
  from: string;
  to: string;
  kind?: 'calls' | 'implements' | 'references' | 'synth' | string;
}

interface View { tx: number; ty: number; k: number }
interface DegreeMap { [id: string]: number }

@Component({
  selector: 'app-graph-canvas',
  imports: [Icon],
  templateUrl: './graph-canvas.html',
  styleUrl: './graph-canvas.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(wheel)': 'onWheel($event)',
    '(mousedown)': 'onMouseDown($event)',
    '(mousemove)': 'onMouseMove($event)',
    '(mouseup)': 'onMouseUp()',
    '(mouseleave)': 'onMouseUp()',
    '[class.no-dot-grid]': '!dotGrid()',
    '[style.background-size]': 'dotGridBgSize()',
    '[style.background-position]': 'dotGridBgPos()',
  },
})
export class GraphCanvas {
  readonly nodes = input<CanvasNode[]>([]);
  readonly edges = input<CanvasEdge[]>([]);
  readonly selectedId = input<string | null>(null);
  readonly fitKey = input<number>(0);
  /** Optional: node ids the parent has filtered out — rendered at 0.2 opacity */
  readonly hiddenIds = input<Set<string>>(new Set());
  /** Set to false for thumbnail/dashboard embeds (no controls, no pan/drag) */
  readonly interactive = input<boolean>(true);
  /** Set to false for non-canvas embeds */
  readonly dotGrid = input<boolean>(true);

  readonly nodeClick = output<string>();

  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');
  protected readonly view = signal<View>({ tx: 0, ty: 0, k: 1 });
  protected readonly hover = signal<string | null>(null);
  protected readonly draggedNodes = signal<Record<string, { x: number; y: number }>>({});
  /** Tracks host size for the minimap viewport rect */
  protected readonly hostSize = signal<{ w: number; h: number }>({ w: 0, h: 0 });

  private drag: null | { type: 'pan'; sx: number; sy: number; ox: number; oy: number }
              | { type: 'node'; id: string; sx: number; sy: number; ox: number; oy: number; moved: boolean } = null;
  private resizeObs: ResizeObserver | null = null;

  // Effective node positions (input positions + any drag overrides)
  protected readonly positioned = computed<CanvasNode[]>(() => {
    const overrides = this.draggedNodes();
    return this.nodes().map((n) => {
      const o = overrides[n.id];
      return o ? { ...n, x: o.x, y: o.y } : n;
    });
  });

  protected readonly nodeMap = computed<Map<string, CanvasNode>>(() => {
    const m = new Map<string, CanvasNode>();
    for (const n of this.positioned()) m.set(n.id, n);
    return m;
  });

  protected readonly neighborSet = computed<Set<string>>(() => {
    const sel = this.selectedId();
    const out = new Set<string>();
    if (!sel) return out;
    for (const e of this.edges()) {
      if (e.from === sel) out.add(e.to);
      if (e.to === sel) out.add(e.from);
    }
    return out;
  });

  /** Connection count per node id (for hub sizing) */
  protected readonly degreeMap = computed<DegreeMap>(() => {
    const d: DegreeMap = {};
    for (const e of this.edges()) {
      d[e.from] = (d[e.from] ?? 0) + 1;
      d[e.to] = (d[e.to] ?? 0) + 1;
    }
    return d;
  });

  constructor() {
    // Reset drag overrides + fit when the input node set changes.
    effect(() => {
      this.nodes();
      this.draggedNodes.set({});
      queueMicrotask(() => this.fitView());
    });
    // Fit on explicit fitKey bump.
    effect(() => {
      this.fitKey();
      queueMicrotask(() => this.fitView());
    });
    // Track host size for minimap
    effect(() => {
      const el = this.host()?.nativeElement;
      if (!el) return;
      if (this.resizeObs) { this.resizeObs.disconnect(); this.resizeObs = null; }
      const ro = new ResizeObserver((entries) => {
        const r = entries[0]?.contentRect;
        if (r) this.hostSize.set({ w: r.width, h: r.height });
      });
      ro.observe(el);
      this.resizeObs = ro;
    });
  }

  protected fitView(): void {
    const el = this.host()?.nativeElement;
    if (!el) return;
    const ns = this.positioned();
    if (ns.length === 0) { this.view.set({ tx: 0, ty: 0, k: 1 }); return; }
    const W = el.clientWidth, H = el.clientHeight;
    if (W === 0 || H === 0) return;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const n of ns) {
      const b = nodeBox(n);
      if (n.x < minX) minX = n.x;
      if (n.x + b.w > maxX) maxX = n.x + b.w;
      if (n.y < minY) minY = n.y;
      if (n.y + b.h > maxY) maxY = n.y + b.h;
    }
    const pad = 60;
    minX -= pad; minY -= pad; maxX += pad; maxY += pad;
    const gw = Math.max(1, maxX - minX), gh = Math.max(1, maxY - minY);
    const k = Math.min(W / gw, H / gh, 1.4) * 0.92;
    this.view.set({
      k,
      tx: (W - gw * k) / 2 - minX * k,
      ty: (H - gh * k) / 2 - minY * k,
    });
  }

  protected onWheel(e: WheelEvent): void {
    if (!this.interactive()) return;
    e.preventDefault();
    const el = this.host().nativeElement.getBoundingClientRect();
    const mx = e.clientX - el.left, my = e.clientY - el.top;
    const delta = -e.deltaY * 0.0016;
    const v = this.view();
    const k = Math.min(2.4, Math.max(0.25, v.k * (1 + delta)));
    const ratio = k / v.k;
    this.view.set({ k, tx: mx - (mx - v.tx) * ratio, ty: my - (my - v.ty) * ratio });
  }

  protected onMouseDown(e: MouseEvent): void {
    if (!this.interactive()) return;
    const target = e.target as HTMLElement;
    const nodeEl = target.closest('[data-node]') as HTMLElement | null;
    if (nodeEl) {
      const id = nodeEl.getAttribute('data-node')!;
      const n = this.nodeMap().get(id);
      if (!n) return;
      e.stopPropagation();
      this.drag = { type: 'node', id, sx: e.clientX, sy: e.clientY, ox: n.x, oy: n.y, moved: false };
      return;
    }
    const v = this.view();
    this.drag = { type: 'pan', sx: e.clientX, sy: e.clientY, ox: v.tx, oy: v.ty };
  }

  protected onMouseMove(e: MouseEvent): void {
    const d = this.drag;
    if (!d) return;
    if (d.type === 'pan') {
      this.view.update((v) => ({ ...v, tx: d.ox + (e.clientX - d.sx), ty: d.oy + (e.clientY - d.sy) }));
      return;
    }
    const k = this.view().k;
    const dx = (e.clientX - d.sx) / k, dy = (e.clientY - d.sy) / k;
    if (Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) > 3) d.moved = true;
    this.draggedNodes.update((o) => ({ ...o, [d.id]: { x: d.ox + dx, y: d.oy + dy } }));
  }

  protected onMouseUp(): void {
    const d = this.drag;
    if (d && d.type === 'node' && !d.moved) {
      this.nodeClick.emit(d.id);
    }
    this.drag = null;
  }

  protected zoom(factor: number): void {
    const el = this.host().nativeElement;
    const W = el.clientWidth, H = el.clientHeight;
    const v = this.view();
    const k = Math.min(2.4, Math.max(0.25, v.k * factor));
    const ratio = k / v.k;
    this.view.set({ k, tx: W / 2 - (W / 2 - v.tx) * ratio, ty: H / 2 - (H / 2 - v.ty) * ratio });
  }

  protected onHoverEnter(id: string): void { this.hover.set(id); }
  protected onHoverLeave(): void { this.hover.set(null); }

  // Geometry helpers (called from template) -----------------------------------

  protected box(n: CanvasNode): { w: number; h: number; shape: 'rect' | 'pill' | 'dot' } { return nodeBox(n); }

  protected edgePath(e: CanvasEdge): string | null {
    const a = this.nodeMap().get(e.from);
    const b = this.nodeMap().get(e.to);
    if (!a || !b) return null;
    const ba = nodeBox(a), bb = nodeBox(b);
    const ax = a.x + ba.w / 2, ay = a.y + ba.h / 2;
    const bx = b.x + bb.w / 2, by = b.y + bb.h / 2;
    const mx = (ax + bx) / 2;
    return `M ${ax} ${ay} C ${mx} ${ay}, ${mx} ${by}, ${bx} ${by}`;
  }

  protected edgeHot(e: CanvasEdge): boolean {
    const s = this.selectedId();
    return !!s && (e.from === s || e.to === s);
  }

  /**
   * Edge stroke color by relationship type:
   * spec-related → --node-spec, test-related → --node-test, else neutral.
   */
  protected edgeStroke(e: CanvasEdge): string {
    const hot = this.edgeHot(e);
    if (hot) return 'var(--accent)';
    const a = this.nodeMap().get(e.from);
    const b = this.nodeMap().get(e.to);
    if (a?.kind === 'spec' || b?.kind === 'spec' || e.kind === 'implements') {
      return 'color-mix(in srgb, var(--node-spec) 62%, transparent)';
    }
    if (a?.kind === 'test' || b?.kind === 'test') {
      return 'color-mix(in srgb, var(--node-test) 62%, transparent)';
    }
    return 'rgba(150,160,180,0.32)';
  }

  protected edgeStrokeWidth(e: CanvasEdge): number {
    const hot = this.edgeHot(e);
    const a = this.nodeMap().get(e.from);
    const b = this.nodeMap().get(e.to);
    const typed = a?.kind === 'spec' || b?.kind === 'spec' || a?.kind === 'test' || b?.kind === 'test'
      || e.kind === 'implements';
    return hot ? 2 : (typed ? 1.5 : 1.2);
  }

  protected edgeOpacity(e: CanvasEdge): number {
    const hot = this.edgeHot(e);
    const hidden = this.hiddenIds();
    if (hidden.size > 0 && (hidden.has(e.from) || hidden.has(e.to))) return 0.12;
    return hot ? 0.95 : 0.72;
  }

  protected nodeColor(n: CanvasNode): string {
    if (n.state === 'drifted') return 'var(--warn)';
    if (n.state === 'broken' || n.state === 'orphaned') return 'var(--error)';
    switch (n.kind) {
      case 'spec':      return 'var(--node-spec)';
      case 'route':     return 'var(--node-route)';
      case 'test':      return 'var(--node-test)';
      case 'class':     return 'var(--node-class, var(--accent-secondary))';
      case 'method':
      case 'function': return 'var(--node-code)';
      default:          return 'var(--node-code)';
    }
  }

  protected nodeOpacity(n: CanvasNode): number {
    const hidden = this.hiddenIds();
    if (hidden.size > 0 && hidden.has(n.id)) return 0.2;
    const s = this.selectedId();
    if (!s) return 1;
    if (n.id === s) return 1;
    return this.neighborSet().has(n.id) ? 1 : 0.55;
  }

  /** Degree-based scale factor for hub nodes (design: 1 + min(0.24, degree * 0.045)) */
  protected nodeScale(n: CanvasNode): number {
    const d = this.degreeMap()[n.id] ?? 0;
    return 1 + Math.min(0.24, d * 0.045);
  }

  protected isSelected(n: CanvasNode): boolean { return n.id === this.selectedId(); }
  protected isHovered(n: CanvasNode): boolean { return n.id === this.hover(); }
  protected zoomLabel(): string { return Math.round(this.view().k * 100) + '%'; }

  /** Dynamic dot-grid background-size (scales with zoom so dots don't stretch) */
  protected dotGridBgSize(): string {
    const s = 22 * this.view().k;
    return `${s}px ${s}px`;
  }
  /** Dynamic dot-grid background-position (pans with viewport translate) */
  protected dotGridBgPos(): string {
    const v = this.view();
    return `${v.tx}px ${v.ty}px`;
  }

  // Minimap helpers -----------------------------------------------------------

  protected minimapNodes(): Array<{ cx: number; cy: number; kind: string; state?: string | null }> {
    const ns = this.positioned();
    if (ns.length === 0) return [];
    const MW = 138, MH = 88, pad = 6;
    const { minX, maxX, minY, maxY } = graphBounds(ns);
    const gw = Math.max(1, maxX - minX), gh = Math.max(1, maxY - minY);
    const s = Math.min((MW - pad * 2) / gw, (MH - pad * 2) / gh);
    const ox = pad + ((MW - pad * 2) - gw * s) / 2;
    const oy = pad + ((MH - pad * 2) - gh * s) / 2;
    return ns.map((n) => ({
      cx: ox + (n.x - minX) * s,
      cy: oy + (n.y - minY) * s,
      kind: n.kind,
      state: n.state,
    }));
  }

  protected minimapViewport(): { x: number; y: number; w: number; h: number } | null {
    const ns = this.positioned();
    if (ns.length === 0) return null;
    const MW = 138, MH = 88, pad = 6;
    const { minX, maxX, minY, maxY } = graphBounds(ns);
    const gw = Math.max(1, maxX - minX), gh = Math.max(1, maxY - minY);
    const s = Math.min((MW - pad * 2) / gw, (MH - pad * 2) / gh);
    const ox = pad + ((MW - pad * 2) - gw * s) / 2;
    const oy = pad + ((MH - pad * 2) - gh * s) / 2;
    const v = this.view();
    const size = this.hostSize();
    if (size.w === 0) return null;
    const vx0 = (-v.tx) / v.k, vy0 = (-v.ty) / v.k;
    const vw = size.w / v.k, vh = size.h / v.k;
    return {
      x: Math.max(0, ox + (vx0 - minX) * s),
      y: Math.max(0, oy + (vy0 - minY) * s),
      w: Math.min(MW, vw * s),
      h: Math.min(MH, vh * s),
    };
  }

  protected minimapNodeColor(kind: string, state?: string | null): string {
    if (kind === 'spec') {
      if (state === 'drifted') return 'var(--warn)';
      if (state === 'broken' || state === 'orphaned') return 'var(--error)';
      return 'var(--node-spec)';
    }
    if (kind === 'test') return 'var(--node-test)';
    if (kind === 'route') return 'var(--node-route)';
    return 'var(--node-code)';
  }
}

function nodeBox(n: CanvasNode): { w: number; h: number; shape: 'rect' | 'pill' | 'dot' } {
  if (n.kind === 'route') return { w: 18, h: 18, shape: 'dot' };
  const w = Math.max(64, n.label.length * (n.kind === 'spec' ? 7.6 : 7.2) + 26);
  return { w, h: 30, shape: n.kind === 'spec' ? 'rect' : 'pill' };
}

function graphBounds(ns: CanvasNode[]): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const n of ns) {
    if (n.x < minX) minX = n.x;
    if (n.x + 120 > maxX) maxX = n.x + 120;
    if (n.y < minY) minY = n.y;
    if (n.y + 50 > maxY) maxY = n.y + 50;
  }
  return { minX, maxX, minY, maxY };
}
