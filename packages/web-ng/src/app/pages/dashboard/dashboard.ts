/**
 * Dashboard — the load-bearing home screen.
 *
 * Layout (matches the React/SpecShip design):
 *   Status strip (in app shell)
 *   Stat tiles row · 4 across · cost / tool calls / subagent share / drift
 *   Mini-graph placeholder + Tips panel (2:1 grid)
 *   File heatstrip
 *   Recent prompts + Cache analytics card (1.4:1 grid)
 *
 * Every data slice is fetched as a signal-based resource. Range selector
 * (today/week/month/all) is a signal — the apiResource effect re-fetches
 * automatically when it changes.
 */
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { DecimalPipe } from '@angular/common';
import { ApiService } from '../../api/api';
import { apiResource } from '../../api/resource';
import { ProjectsService } from '../../api/projects';
import { Icon } from '../../shell/icon/icon';
import { GraphCanvas, type CanvasNode, type CanvasEdge } from '../../charts/graph-canvas/graph-canvas';
import type {
  StatusResponse,
  CostsResponse,
  CacheResponse,
  HeatmapResponse,
  TipsResponse,
  SessionsResponse,
  GraphSearchResponse,
} from '../../api/types';

type Range = 'today' | 'week' | 'month' | 'all';

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink, DecimalPipe, Icon, GraphCanvas],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Dashboard {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly projects = inject(ProjectsService);

  protected readonly range = signal<Range>('week');
  protected readonly ranges: Range[] = ['today', 'week', 'month', 'all'];

  protected readonly status = apiResource<StatusResponse>(this.api, () => `/api/status${this.projects.projectQuery()}`);
  // For the mini-graph: pull a generic recent-symbol search; if anything
  // comes back, lay those out as the "recent neighborhood". The endpoint
  // accepts any 2+ char query; we use a short hint biased toward identifiers
  // commonly present in modern codebases. Falls back to seed nodes when
  // the API returns no rows (typical in fresh dev environments).
  protected readonly miniGraphSearch = apiResource<GraphSearchResponse>(
    this.api,
    () => `/api/graph/search?q=on&limit=18${this.projects.projectQuery('&')}`,
  );
  protected readonly tips = apiResource<TipsResponse>(this.api, () => '/api/claude/tips');
  protected readonly heatmap = apiResource<HeatmapResponse>(this.api, () => `/api/claude/heatmap?range=${this.range()}`);
  protected readonly costs = apiResource<CostsResponse>(this.api, () => `/api/claude/costs?range=${this.range()}`);
  protected readonly cache = apiResource<CacheResponse>(this.api, () => `/api/claude/cache?range=${this.range()}`);
  protected readonly sessions = apiResource<SessionsResponse>(
    this.api,
    () => `/api/claude/sessions?range=${this.range()}&limit=10`
  );

  // Derived metrics ---------------------------------------------------------

  protected readonly lastSession = computed(() => {
    const arr = this.sessions.state().data?.sessions ?? [];
    return arr[0] ?? null;
  });

  protected readonly lastSessionCost = computed(() => this.lastSession()?.total_cost_usd ?? 0);

  protected readonly toolCallCount = computed(() => {
    const tools = this.heatmap.state().data?.tools ?? [];
    return tools.reduce((sum, t) => sum + (t.calls ?? 0), 0);
  });

  protected readonly subagentShare = computed(() => {
    const subs = this.heatmap.state().data?.subagents ?? [];
    const sub = subs.find((s) => s.type === 'subagent');
    const main = subs.find((s) => s.type === 'main');
    const subCost = sub?.cost ?? 0;
    const mainCost = main?.cost ?? 0;
    const total = subCost + mainCost;
    return total > 0 ? Math.round((subCost / total) * 100) : 0;
  });

  protected readonly driftCount = computed(() => this.status.state().data?.drift ?? 0);
  protected readonly nodeCountLabel = computed(() => this.status.state().data?.nodeCount ?? 0);

  protected readonly topFiles = computed(() => (this.heatmap.state().data?.files ?? []).slice(0, 30));
  protected readonly maxFileCalls = computed(() => {
    const max = Math.max(0, ...this.topFiles().map((f) => f.calls ?? 0));
    return max > 0 ? max : 1;
  });

  protected readonly topPrompts = computed(() => (this.costs.state().data?.topPrompts ?? []).slice(0, 8));
  protected readonly maxPromptCost = computed(() => {
    const max = Math.max(0.01, ...this.topPrompts().map((p) => p.cost_usd ?? 0));
    return max;
  });

  protected readonly rangeTotal = computed(() => {
    const series = this.costs.state().data?.series ?? [];
    return series.reduce((sum, d) => sum + (d.cost ?? 0), 0);
  });

  protected readonly liveSource = computed(() =>
    this.status.state().source === 'api' && this.status.state().data ? 'live' : 'mock'
  );

  // Actions -----------------------------------------------------------------

  protected setRange(r: Range): void { this.range.set(r); }

  protected go(route: string): void {
    this.router.navigate(['/' + route]);
  }

  protected fmt$(n: number): string {
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  protected fmtK(n: number): string {
    if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k';
    return String(n);
  }

  protected promptCacheRate(p: { cache_read_tokens?: number; input_tokens?: number; cache_creation_tokens?: number }): number {
    const tokens = (p.input_tokens ?? 0) + (p.cache_creation_tokens ?? 0) + (p.cache_read_tokens ?? 0);
    return tokens > 0 ? (p.cache_read_tokens ?? 0) / tokens : 0;
  }

  protected promptTotalTokens(p: { input_tokens?: number; output_tokens?: number; cache_creation_tokens?: number; cache_read_tokens?: number }): number {
    return (p.input_tokens ?? 0) + (p.output_tokens ?? 0) + (p.cache_creation_tokens ?? 0) + (p.cache_read_tokens ?? 0);
  }

  protected fileBg(calls: number): string {
    const t = calls / this.maxFileCalls();
    const pct = Math.round(18 + t * 70);
    return `color-mix(in srgb, var(--warn) ${pct}%, var(--bg-elevated))`;
  }

  protected fileColor(calls: number): string {
    return calls / this.maxFileCalls() > 0.5 ? '#fff' : 'var(--text-secondary)';
  }

  protected promptBarColor(cost: number): string {
    return cost / this.maxPromptCost() > 0.7 ? 'var(--error)' : 'var(--accent)';
  }

  protected promptFrac(cost: number): number {
    return Math.max(0, Math.min(1, cost / this.maxPromptCost()));
  }

  protected sessionIdShort(id: string | undefined): string {
    return (id ?? '').slice(0, 8);
  }

  // --- Mini graph (dashboard "recent neighborhood" card) --------------------

  protected readonly miniGraphSource = computed<'api' | 'seed'>(() =>
    (this.miniGraphSearch.state().data?.results?.length ?? 0) > 0 ? 'api' : 'seed',
  );

  protected readonly miniGraphNodes = computed<CanvasNode[]>(() => {
    const apiResults = this.miniGraphSearch.state().data?.results ?? [];
    if (apiResults.length > 0) {
      return layoutCluster(
        apiResults.slice(0, 18).map((r) => ({
          id: r.node.id,
          label: r.node.name,
          sub: r.node.filePath?.split('/').slice(-2).join('/'),
          kind: r.node.kind,
        })),
      );
    }
    return SEED_NEIGHBORHOOD_NODES;
  });

  protected readonly miniGraphEdges = computed<CanvasEdge[]>(() => {
    if (this.miniGraphSource() === 'api') {
      // Synthesize light edges between successive nodes — the search endpoint
      // doesn't return edges, so we draw a sparse spanning tree to keep the
      // canvas visually grounded.
      const nodes = this.miniGraphNodes();
      const edges: CanvasEdge[] = [];
      for (let i = 1; i < nodes.length; i++) {
        const from = nodes[Math.floor(Math.random() * i)];
        const to = nodes[i];
        if (from && to) edges.push({ from: from.id, to: to.id, kind: 'calls' });
      }
      return edges;
    }
    return SEED_NEIGHBORHOOD_EDGES;
  });

  protected onMiniGraphPick(id: string): void {
    this.router.navigate(['/graph'], { queryParams: { focus: id } });
  }
}

// ---------------------------------------------------------------------------
// Seed mini-graph used when the API returns nothing. Mirrors the design's
// prototype (~12-15 nodes laid out around a central area, all four node
// kinds represented). Coordinates are tuned for the dashboard's 340px-tall
// card.
// ---------------------------------------------------------------------------

const SEED_NEIGHBORHOOD_NODES: CanvasNode[] = [
  { id: 's-1', label: 'validateSession', sub: 'src/auth.ts', kind: 'function', x: 0, y: 0 },
  { id: 's-2', label: 'checkExpiry', sub: 'src/auth.ts', kind: 'method', x: -180, y: -70 },
  { id: 's-3', label: 'signToken', sub: 'src/auth.ts', kind: 'function', x: -180, y: 50 },
  { id: 's-4', label: 'AuthRoute', sub: 'src/routes/auth.ts', kind: 'route', x: 200, y: -90 },
  { id: 's-5', label: 'login', sub: 'src/routes/auth.ts', kind: 'function', x: 200, y: 30 },
  { id: 's-6', label: 'logout', sub: 'src/routes/auth.ts', kind: 'function', x: 230, y: 110 },
  { id: 's-7', label: 'auth.test.ts', sub: 'test/auth.test.ts', kind: 'test', x: -240, y: 140 },
  { id: 's-8', label: 'session.test.ts', sub: 'test/session.test.ts', kind: 'test', x: -100, y: 180 },
  { id: 's-9', label: 'REQ-AUTH-005', sub: 'reject expired tokens', kind: 'spec', state: 'drifted', x: 30, y: -180 },
  { id: 's-10', label: 'REQ-AUTH-001', sub: 'sign session tokens', kind: 'spec', state: 'verified', x: -150, y: -190 },
  { id: 's-11', label: 'User', sub: 'src/types/user.ts', kind: 'class', x: -340, y: -10 },
  { id: 's-12', label: 'Session', sub: 'src/types/session.ts', kind: 'class', x: 60, y: 130 },
  { id: 's-13', label: 'jwtSign', sub: 'src/lib/jwt.ts', kind: 'function', x: -340, y: 80 },
  { id: 's-14', label: 'jwtVerify', sub: 'src/lib/jwt.ts', kind: 'function', x: 350, y: -10 },
  { id: 's-15', label: 'tokenStore', sub: 'src/db/tokens.ts', kind: 'function', x: 350, y: 90 },
];

const SEED_NEIGHBORHOOD_EDGES: CanvasEdge[] = [
  { from: 's-1', to: 's-2', kind: 'calls' },
  { from: 's-1', to: 's-3', kind: 'calls' },
  { from: 's-4', to: 's-5', kind: 'calls' },
  { from: 's-4', to: 's-6', kind: 'calls' },
  { from: 's-5', to: 's-1', kind: 'calls' },
  { from: 's-6', to: 's-1', kind: 'calls' },
  { from: 's-3', to: 's-13', kind: 'calls' },
  { from: 's-2', to: 's-14', kind: 'calls' },
  { from: 's-1', to: 's-12', kind: 'references' },
  { from: 's-5', to: 's-11', kind: 'references' },
  { from: 's-9', to: 's-1', kind: 'implements' },
  { from: 's-10', to: 's-3', kind: 'implements' },
  { from: 's-7', to: 's-1', kind: 'references' },
  { from: 's-8', to: 's-12', kind: 'references' },
  { from: 's-14', to: 's-15', kind: 'calls' },
];

function layoutCluster(items: Array<{ id: string; label: string; sub?: string; kind: string }>): CanvasNode[] {
  // Simple deterministic radial layout — ring of (N-1) nodes around a center.
  if (items.length === 0) return [];
  const head = items[0]!;
  const ring = items.slice(1);
  const nodes: CanvasNode[] = [
    { id: head.id, label: head.label, sub: head.sub, kind: head.kind, x: 0, y: 0 },
  ];
  const radius = 220;
  for (let i = 0; i < ring.length; i++) {
    const angle = (i / ring.length) * Math.PI * 2 - Math.PI / 2;
    const r = ring[i]!;
    nodes.push({
      id: r.id,
      label: r.label,
      sub: r.sub,
      kind: r.kind,
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
    });
  }
  return nodes;
}
