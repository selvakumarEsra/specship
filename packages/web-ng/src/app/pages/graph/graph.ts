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
import { ApiService } from '../../api/api';
import { apiResource } from '../../api/resource';
import { ProjectsService } from '../../api/projects';
import { PickProjectEmpty } from '../../shell/pick-project-empty/pick-project-empty';
import type {
  GraphSearchResponse,
  GraphNodeResponse,
  GraphNodeDetail,
  GraphNode,
  StatusResponse,
} from '../../api/types';
import { CanvasEdge, CanvasNode, GraphCanvas } from '../../charts/graph-canvas/graph-canvas';

type KindKey = 'code' | 'spec' | 'route' | 'test';

@Component({
  selector: 'app-graph',
  imports: [GraphCanvas, PickProjectEmpty],
  templateUrl: './graph.html',
  styleUrl: './graph.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Graph {
  private readonly api = inject(ApiService);
  private readonly projects = inject(ProjectsService);

  protected readonly status = apiResource<StatusResponse>(this.api, () => `/api/status${this.projects.projectQuery()}`);

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
    if (!detail) return { nodes: [], edges: [] };

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

  protected readonly visibleNodes = computed(() => this.canvasData().nodes);
  protected readonly visibleEdges = computed(() => this.canvasData().edges);

  // Counts for the kind chips.
  protected readonly kindCounts = computed<Record<KindKey, number>>(() => {
    const c: Record<KindKey, number> = { code: 0, spec: 0, route: 0, test: 0 };
    for (const n of this.canvasData().nodes) c[kindOf(n.kind)]++;
    return c;
  });

  protected readonly kindKeys: KindKey[] = ['code', 'spec', 'route', 'test'];

  protected isFilterActive(k: KindKey): boolean { return this.filters()[k]; }
  protected countFor(k: KindKey): number { return this.kindCounts()[k]; }

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
    if (!detail) return;
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

  protected clearSelection(): void { this.selectedSymbol.set(null); }

  protected shortPath(p: string): string { return shortPath(p); }

  protected kindLabel(k: string): string {
    return k.charAt(0).toUpperCase() + k.slice(1);
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
