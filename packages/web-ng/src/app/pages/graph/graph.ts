/**
 * Graph page — interactive code explorer.
 *
 * Workflow:
 *   1. User types a symbol in the search box → fuzzy hits via /api/graph/search.
 *   2. Clicking a hit (or hitting Enter on the first hit) fetches the node
 *      detail via /api/graph/node?symbol=X — that returns the node + its
 *      1-hop callers, callees, and linkedSpecs.
 *   3. The page lays them out radially around the center node and renders
 *      via <app-graph-canvas>.
 *   4. Clicking any neighbor in the canvas recenters the view on it.
 */
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from '../../api/api';
import { apiResource } from '../../api/resource';
import { ProjectsService } from '../../api/projects';
import { PickProjectEmpty } from '../../shell/pick-project-empty/pick-project-empty';
import type {
  GraphSearchResponse,
  GraphNodeResponse,
  GraphNodeDetail,
  GraphNode,
  GraphHealthResponse,
  FullGraphResponse,
  StatusResponse,
} from '../../api/types';
import { CanvasEdge, CanvasNode, GraphCanvas } from '../../charts/graph-canvas/graph-canvas';
import { layoutGraph } from '../../charts/graph-canvas/layout';
import { Icon } from '../../shell/icon/icon';
import { Segmented, type SegmentedOption } from '../../ui/segmented';
import { StatePill } from '../../ui/state-pill';
import { CopyBtn } from '../../ui/copy-btn';

type KindKey = 'code' | 'spec' | 'route' | 'test';
type LayoutMode = 'hierarchical' | 'force' | 'anchored';

@Component({
  selector: 'app-graph',
  imports: [GraphCanvas, PickProjectEmpty, Icon, Segmented, StatePill, CopyBtn],
  templateUrl: './graph.html',
  styleUrl: './graph.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Graph {
  private readonly api = inject(ApiService);
  private readonly projects = inject(ProjectsService);
  private readonly router = inject(Router);

  protected readonly status = apiResource<StatusResponse>(this.api, () => `/api/status${this.projects.projectQuery()}`);
  protected readonly health = apiResource<GraphHealthResponse>(this.api, () => `/api/graph/health${this.projects.projectQuery()}`);
  /** Whole-repo overview (top-N most-connected nodes), shown when nothing is selected. */
  protected readonly fullGraph = apiResource<FullGraphResponse>(this.api, () => `/api/graph/full?limit=250${this.projects.projectQuery('&')}`);

  // Layout mode
  protected readonly layoutMode = signal<LayoutMode>('hierarchical');
  protected readonly layoutOptions: SegmentedOption[] = [
    { value: 'hierarchical', label: 'Hierarchical' },
    { value: 'force', label: 'Force' },
    { value: 'anchored', label: 'Anchored' },
  ];

  // Search box state. Debounced into searchQuery for the API.
  protected readonly searchInput = signal('');
  protected readonly searchQuery = signal('');
  private searchDebounce: ReturnType<typeof setTimeout> | null = null;

  protected readonly searchResults = apiResource<GraphSearchResponse>(this.api, () => {
    const q = this.searchQuery().trim();
    return q.length >= 2 ? `/api/graph/search?q=${encodeURIComponent(q)}&limit=12${this.projects.projectQuery('&')}` : null;
  });

  // Selected symbol drives the canvas. `null` until the user picks one.
  protected readonly selectedSymbol = signal<string | null>(null);

  protected readonly nodeDetail = apiResource<GraphNodeResponse>(this.api, () => {
    const s = this.selectedSymbol();
    return s ? `/api/graph/node?symbol=${encodeURIComponent(s)}${this.projects.projectQuery('&')}` : null;
  });

  protected readonly selectedDetail = computed<GraphNodeDetail | null>(() => {
    return this.nodeDetail.state().data?.matches?.[0] ?? null;
  });

  // Kind filters — toggle to hide a kind in the canvas.
  protected readonly filters = signal<Record<KindKey, boolean>>({
    code: true,
    spec: true,
    route: true,
    test: true,
  });

  // Force a refit of the canvas when layout changes.
  protected readonly fitKey = signal(0);

  // --- Layout ---------------------------------------------------------------

  protected readonly canvasData = computed<{ nodes: CanvasNode[]; edges: CanvasEdge[] }>(() => {
    const detail = this.selectedDetail();
    if (!detail) return this.fullGraphData();

    const f = this.filters();
    const visible = (kind: string) => {
      const k = kindOf(kind);
      return f[k];
    };

    const center: CanvasNode = {
      id: detail.id,
      label: detail.name,
      sub: shortPath(detail.filePath),
      kind: detail.kind,
      x: 0,
      y: 0,
    };

    const callers = (detail.callers ?? []).filter((n) => visible(n.kind));
    const callees = (detail.callees ?? []).filter((n) => visible(n.kind));
    const specs = (detail.linkedSpecs ?? []).filter(() => f.spec);

    const COL_X = 280;
    const ROW_H = 56;

    const nodes: CanvasNode[] = [center];
    const edges: CanvasEdge[] = [];

    callers.forEach((n, i) => {
      const y = (i - (callers.length - 1) / 2) * ROW_H;
      nodes.push(toCanvas(n, -COL_X, y));
      edges.push({ from: n.id, to: detail.id, kind: 'calls' });
    });

    callees.forEach((n, i) => {
      const y = (i - (callees.length - 1) / 2) * ROW_H;
      nodes.push(toCanvas(n, COL_X, y));
      edges.push({ from: detail.id, to: n.id, kind: 'calls' });
    });

    specs.forEach((link, i) => {
      const x = (i - (specs.length - 1) / 2) * 220;
      const specNodeId = 'spec:' + link.specId;
      nodes.push({
        id: specNodeId,
        label: link.specId,
        sub: link.specTitle ?? undefined,
        kind: 'spec',
        state: link.state,
        x,
        y: -160,
      });
      edges.push({ from: specNodeId, to: detail.id, kind: 'implements' });
    });

    return { nodes, edges };
  });

  /**
   * Whole-repo overview: the top-N nodes from /api/graph/full, filtered by kind,
   * positioned by the active layout mode. Recomputes when the layout toggle, the
   * kind filters, or the fetched graph change.
   */
  private fullGraphData(): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
    const data = this.fullGraph.state().data;
    if (!data?.nodes?.length) return { nodes: [], edges: [] };

    const f = this.filters();
    const fnodes = data.nodes.filter((n) => f[kindOf(n.kind)]);
    const keep = new Set(fnodes.map((n) => n.id));
    const fedges = data.edges.filter((e) => keep.has(e.from) && keep.has(e.to));
    const kindById = new Map(fnodes.map((n) => [n.id, n.kind] as const));

    const pos = layoutGraph(
      this.layoutMode(),
      fnodes.map((n) => ({ id: n.id, kind: n.kind })),
      fedges.map((e) => ({ from: e.from, to: e.to })),
    );

    const nodes: CanvasNode[] = fnodes.map((n) => ({
      id: n.id,
      label: n.name,
      sub: shortPath(n.filePath),
      kind: n.kind,
      x: pos.get(n.id)?.x ?? 0,
      y: pos.get(n.id)?.y ?? 0,
    }));
    const edges: CanvasEdge[] = fedges.map((e) => ({
      from: e.from,
      to: e.to,
      kind: e.provenance === 'heuristic' ? 'synth'
        : (kindById.get(e.from) === 'spec' || kindById.get(e.to) === 'spec') ? 'implements'
        : 'calls',
    }));
    return { nodes, edges };
  }

  /** True when the canvas is showing the whole-repo overview (nothing selected). */
  protected readonly fullGraphActive = computed(() => !this.selectedSymbol() && this.fullGraphData().nodes.length > 0);
  protected readonly fullGraphLoading = computed(() => !this.selectedSymbol() && this.fullGraph.state().loading);
  protected readonly fullGraphCounts = computed(() => {
    const d = this.fullGraph.state().data;
    return d ? { shown: d.shown, total: d.total } : { shown: 0, total: 0 };
  });

  protected readonly visibleNodes = computed(() => this.canvasData().nodes);
  protected readonly visibleEdges = computed(() => this.canvasData().edges);

  /** Hidden id set passed to canvas (for kind filter dimming) */
  protected readonly hiddenIds = computed<Set<string>>(() => {
    const f = this.filters();
    const h = new Set<string>();
    for (const n of this.canvasData().nodes) {
      if (!f[kindOf(n.kind)]) h.add(n.id);
    }
    return h;
  });

  // Counts for the kind chips (from current canvas data).
  protected readonly kindCounts = computed<Record<KindKey, number>>(() => {
    const c: Record<KindKey, number> = { code: 0, spec: 0, route: 0, test: 0 };
    for (const n of this.canvasData().nodes) c[kindOf(n.kind)]++;
    return c;
  });

  // --- Overview panel (shown when nothing selected) -------------------------

  /** Node counts by kind from the status endpoint */
  protected readonly overviewKindCounts = computed<Record<KindKey, number>>(() => {
    const data = this.status.state().data;
    if (!data?.nodesByKind) return { code: 0, spec: 0, route: 0, test: 0 };
    const m = data.nodesByKind;
    const code = (m['function'] ?? 0) + (m['method'] ?? 0) + (m['class'] ?? 0)
      + (m['variable'] ?? 0) + (m['constant'] ?? 0) + (m['type_alias'] ?? 0)
      + (m['interface'] ?? 0) + (m['struct'] ?? 0) + (m['enum'] ?? 0)
      + (m['property'] ?? 0) + (m['field'] ?? 0) + (m['file'] ?? 0)
      + (m['module'] ?? 0) + (m['namespace'] ?? 0) + (m['component'] ?? 0);
    return {
      code,
      spec: m['spec'] ?? 0,
      route: m['route'] ?? 0,
      test: m['test'] ?? 0,
    };
  });

  protected readonly kindKeys: KindKey[] = ['code', 'spec', 'route', 'test'];

  protected isFilterActive(k: KindKey): boolean { return this.filters()[k]; }
  protected countFor(k: KindKey): number { return this.kindCounts()[k]; }

  protected chipColor(k: KindKey): string {
    switch (k) {
      case 'spec':  return 'var(--node-spec)';
      case 'route': return 'var(--node-route)';
      case 'test':  return 'var(--node-test)';
      default:      return 'var(--node-code)';
    }
  }

  // --- Actions --------------------------------------------------------------

  protected onSearchInput(v: string): void {
    this.searchInput.set(v);
    if (this.searchDebounce) clearTimeout(this.searchDebounce);
    this.searchDebounce = setTimeout(() => this.searchQuery.set(v), 180);
  }

  protected pickResult(node: GraphNode): void {
    this.searchInput.set(node.name);
    this.searchQuery.set('');
    this.selectedSymbol.set(node.name);
  }

  protected pickFromCanvas(id: string): void {
    const detail = this.selectedDetail();
    if (!detail) {
      // Whole-repo overview: clicking a node drills into its neighborhood.
      const node = this.fullGraph.state().data?.nodes.find((n) => n.id === id);
      if (node) {
        this.selectedSymbol.set(node.name);
        this.fitKey.update((k) => k + 1);
      }
      return;
    }
    if (id === detail.id) return;
    const all = [...(detail.callers ?? []), ...(detail.callees ?? [])];
    const hit = all.find((n) => n.id === id);
    if (hit) {
      this.selectedSymbol.set(hit.name);
      this.fitKey.update((k) => k + 1);
    }
  }

  protected toggleFilter(k: KindKey): void {
    this.filters.update((f) => ({ ...f, [k]: !f[k] }));
    this.fitKey.update((v) => v + 1);
  }

  protected recenter(): void { this.fitKey.update((v) => v + 1); }

  protected clearSelection(): void {
    this.selectedSymbol.set(null);
    this.searchInput.set('');
  }

  protected onLayoutChange(mode: string): void {
    this.layoutMode.set(mode as LayoutMode);
    this.fitKey.update((k) => k + 1);
  }

  protected shortPath(p: string | null | undefined): string { return shortPath(p); }
  protected fileName(p: string | null | undefined): string {
    if (!p) return '';
    return p.split('/').pop() ?? '';
  }

  protected kindLabel(k: string): string {
    return k.charAt(0).toUpperCase() + k.slice(1);
  }

  protected navigateToSpecs(): void {
    this.router.navigate(['/specs']);
  }

  protected navigateToDrift(): void {
    this.router.navigate(['/drift']);
  }

  /** Color for any arbitrary node kind — used by hub rows in the overview panel. */
  protected nodeColor(kind: string): string {
    if (kind === 'spec') return 'var(--node-spec)';
    if (kind === 'route') return 'var(--node-route)';
    if (kind === 'test') return 'var(--node-test)';
    return 'var(--node-code)';
  }

  /** Select a hub node by name (mirrors pickResult). */
  protected pickHub(hub: { name: string }): void {
    this.selectedSymbol.set(hub.name);
    this.fitKey.update((k) => k + 1);
  }

  /** Node color for the detail panel header dot + kind pill.
   *  For spec nodes, check linked spec health to pick drift/broken color.
   *  (GraphNodeDetail has no `state` field — state lives on SpecLink.)
   */
  protected detailColor(d: GraphNodeDetail): string {
    if (d.kind === 'spec') {
      // Derive color from the aggregate link health
      const links = d.linkedSpecs ?? [];
      const hasBroken = links.some((l) => l.state === 'broken' || l.state === 'orphaned');
      const hasDrifted = !hasBroken && links.some((l) => l.state === 'drifted');
      if (hasBroken) return 'var(--error)';
      if (hasDrifted) return 'var(--warn)';
      return 'var(--node-spec)';
    }
    if (d.kind === 'test') return 'var(--node-test)';
    if (d.kind === 'route') return 'var(--node-route)';
    return 'var(--node-code)';
  }
}

function toCanvas(n: GraphNode, x: number, y: number): CanvasNode {
  return {
    id: n.id,
    label: n.name,
    sub: shortPath(n.filePath),
    kind: n.kind,
    x,
    y,
  };
}

function shortPath(p: string | null | undefined): string {
  if (!p) return '';
  const parts = p.split('/');
  return parts.slice(-2).join('/');
}

function kindOf(k: string): KindKey {
  if (k === 'spec') return 'spec';
  if (k === 'route') return 'route';
  if (k === 'test') return 'test';
  return 'code';
}
