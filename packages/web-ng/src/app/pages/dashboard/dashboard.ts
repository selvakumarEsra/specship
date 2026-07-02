/**
 * Dashboard — the load-bearing home screen.
 *
 * Layout (matches the React/SpecShip design screens-dashboard.jsx):
 *   PageHead (icon + title + sub + range Segmented in actions slot)
 *   Stat tiles row · 4 across · cost / tool calls / subagent share / drift
 *     Each tile: icon + eyebrow, big value (23px/650), inline Sparkline, Delta
 *   Center row 2fr 1fr gap12 height 340:
 *     left  — "Recent neighborhood" GraphCanvas card
 *     right — "Tips" card with TipRows (dismiss, Apply)
 *   Heatstrip → <app-treemap> height 116 + legend
 *   Bottom row 1.4fr 1fr gap12:
 *     left  — Recent prompts · by cost (PromptRow: text, Bar 70%, $cost, tokens·cache%)
 *     right — CacheCard (38px rate, divider, 2×2 kv grid)
 *   Footer (range window total + live/mock dot)
 */
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { DecimalPipe } from '@angular/common';
import { ApiService } from '../../api/api';
import { apiResource } from '../../api/resource';
import { shortLabel } from '../../util/paths';
import { ProjectsService } from '../../api/projects';
import { ConnectionService } from '../../api/connection';
import { Icon } from '../../shell/icon/icon';
import { PageHead } from '../../ui/page-head';
import { Segmented, type SegmentedOption } from '../../ui/segmented';
import { Delta } from '../../ui/delta';
import { Bar } from '../../ui/bar';
import { Sparkline } from '../../charts/sparkline/sparkline';
import { Treemap, type TreemapItem } from '../../charts/treemap/treemap';
import { GraphCanvas, type CanvasNode, type CanvasEdge } from '../../charts/graph-canvas/graph-canvas';
import type {
  StatusResponse,
  CostsResponse,
  CacheResponse,
  HeatmapResponse,
  TipsResponse,
  SessionsResponse,
  GraphSearchResponse,
  StatsResponse,
  StatMetric,
} from '../../api/types';

type Range = 'today' | 'week' | 'month' | 'all';

@Component({
  selector: 'app-dashboard',
  imports: [
    RouterLink,
    DecimalPipe,
    Icon,
    PageHead,
    Segmented,
    Delta,
    Bar,
    Sparkline,
    Treemap,
    GraphCanvas,
  ],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Dashboard {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly projects = inject(ProjectsService);
  private readonly conn = inject(ConnectionService);

  protected readonly range = signal<Range>('week');

  protected readonly rangeOptions: SegmentedOption[] = [
    { value: 'today', label: 'Today' },
    { value: 'week', label: 'This week' },
    { value: 'month', label: 'This month' },
    { value: 'all', label: 'All time' },
  ];

  // Resources ----------------------------------------------------------------

  protected readonly status = apiResource<StatusResponse>(
    this.api,
    () => `/api/status${this.projects.projectQuery()}`,
  );

  protected readonly miniGraphSearch = apiResource<GraphSearchResponse>(
    this.api,
    () => `/api/graph/search?q=on&limit=18${this.projects.projectQuery('&')}`,
  );

  protected readonly tips = apiResource<TipsResponse>(this.api, () => '/api/claude/tips');

  protected readonly heatmap = apiResource<HeatmapResponse>(
    this.api,
    () => `/api/claude/heatmap?range=${this.range()}`,
  );

  protected readonly costs = apiResource<CostsResponse>(
    this.api,
    () => `/api/claude/costs?range=${this.range()}`,
  );

  protected readonly cache = apiResource<CacheResponse>(
    this.api,
    () => `/api/claude/cache?range=${this.range()}`,
  );

  protected readonly sessions = apiResource<SessionsResponse>(
    this.api,
    () => `/api/claude/sessions?range=${this.range()}&limit=10`,
  );

  protected readonly stats = apiResource<StatsResponse>(
    this.api,
    () => `/api/claude/stats?range=${this.range()}`,
  );

  // Per-tile metric accessors — always return a StatMetric so the template
  // never touches an undefined nested field (value 0 / delta 0 / empty spark).
  private readonly EMPTY_METRIC: StatMetric = { value: 0, delta: 0, series: [] };
  protected readonly lastSessionCostStat = computed(() => this.stats.state().data?.lastSessionCost ?? this.EMPTY_METRIC);
  protected readonly toolCallsStat = computed(() => this.stats.state().data?.toolCalls ?? this.EMPTY_METRIC);
  protected readonly subagentPctStat = computed(() => this.stats.state().data?.subagentPct ?? this.EMPTY_METRIC);
  protected readonly driftStat = computed(() => this.stats.state().data?.drift ?? this.EMPTY_METRIC);

  // Derived metrics ----------------------------------------------------------

  protected readonly lastSession = computed(() => {
    const arr = this.sessions.state().data?.sessions ?? [];
    return arr[0] ?? null;
  });

  protected readonly lastSessionCost = computed(
    () => this.lastSession()?.total_cost_usd ?? 0,
  );

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

  // Tip counts ---------------------------------------------------------------
  protected readonly urgentTipCount = computed(() => {
    const tps = this.tips.state().data?.tips ?? [];
    return tps.filter((t) => t.severity === 'error').length;
  });

  // Tip dismiss state — keyed by tip id
  protected readonly dismissedTips = signal<Set<string>>(new Set());

  protected dismissTip(id: string): void {
    this.dismissedTips.update((s) => {
      const next = new Set(s);
      next.add(id);
      return next;
    });
  }

  protected isTipDismissed(id: string): boolean {
    return this.dismissedTips().has(id);
  }

  // Visible (non-dismissed) tips, max 4
  protected readonly visibleTips = computed(() => {
    const dismissed = this.dismissedTips();
    return (this.tips.state().data?.tips ?? [])
      .filter((t) => !dismissed.has(t.id))
      .slice(0, 4);
  });

  // Heatmap treemap items ----------------------------------------------------
  protected readonly treemapItems = computed<TreemapItem[]>(() => {
    const files = (this.heatmap.state().data?.files ?? []).slice(0, 30);
    if (!files.length) return [];
    const maxTpc = Math.max(
      1,
      ...files.map((f) => (f.resultBytes && f.calls ? f.resultBytes / f.calls : 0)),
    );
    return files.map((f) => {
      const tpc = f.calls > 0 ? f.resultBytes / f.calls : 0;
      const intensity = Math.min(1, tpc / maxTpc);
      return {
        key: f.path,
        label: shortLabel(f.path),
        value: f.calls,
        intensity,
        sub: f.calls + ' calls',
        title: `${f.path}\n${f.calls} calls · ${this.fmtK(Math.round(tpc))}/call`,
      };
    });
  });

  // Recent prompts -----------------------------------------------------------
  protected readonly topPrompts = computed(() =>
    (this.costs.state().data?.topPrompts ?? []).slice(0, 8),
  );

  protected readonly maxPromptCost = computed(() =>
    Math.max(0.01, ...this.topPrompts().map((p) => p.cost_usd ?? 0)),
  );

  // Footer -------------------------------------------------------------------
  protected readonly rangeTotal = computed(() => {
    const series = this.costs.state().data?.series ?? [];
    return series.reduce((sum, d) => sum + (d.cost ?? 0), 0);
  });

  protected readonly liveSource = computed<'live' | 'offline'>(() =>
    this.conn.online() ? 'live' : 'offline',
  );

  // Mini graph ---------------------------------------------------------------
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

  /**
   * The three command doors (DASH-DOORS-DOC, REQ-DASH-DOORS-001). SpecShip's
   * agent-facing slash commands consolidated into these entry points; the card
   * surfaces them so a user knows the whole command surface is three doors.
   * `route` is the most-related dashboard page each door links to.
   */
  protected readonly doors: ReadonlyArray<{
    id: string; label: string; cmd: string; icon: string;
    color: string; blurb: string; subs: string[]; route: string;
  }> = [
    {
      id: 'intent', label: 'Intent', cmd: '/specship:spec', icon: 'book',
      color: 'var(--node-spec)', route: 'specs',
      blurb: 'View, author, implement, review, or extend a spec — the whole lifecycle.',
      subs: ['new', 'fast', 'implement', 'review', 'triage', 'behaviour', 'domain'],
    },
    {
      id: 'reads', label: 'Reads', cmd: '/specship:explore', icon: 'search',
      color: 'var(--accent)', route: 'graph',
      blurb: 'Explore an area, trace a flow, or get a change’s blast radius.',
      subs: ['explore', 'flow', 'impact'],
    },
    {
      id: 'gate', label: 'Gate & health', cmd: '/specship:check', icon: 'check',
      color: 'var(--warn)', route: 'drift',
      blurb: 'Run the enforcement gate, review drift, repair links, or see code-health.',
      subs: ['gate', 'drifted', 'fix', 'relink', 'health'],
    },
  ];

  // Actions ------------------------------------------------------------------

  protected setRange(r: string): void {
    this.range.set(r as Range);
  }

  protected go(route: string): void {
    this.router.navigate(['/' + route]);
  }

  // Formatting helpers -------------------------------------------------------

  protected fmt$(n: number): string {
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  protected fmtK(n: number): string {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k';
    return String(n);
  }

  protected promptCacheRate(p: {
    cache_read_tokens?: number;
    input_tokens?: number;
    cache_creation_tokens?: number;
  }): number {
    const tokens =
      (p.input_tokens ?? 0) +
      (p.cache_creation_tokens ?? 0) +
      (p.cache_read_tokens ?? 0);
    return tokens > 0 ? (p.cache_read_tokens ?? 0) / tokens : 0;
  }

  protected promptTotalTokens(p: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_tokens?: number;
    cache_read_tokens?: number;
  }): number {
    return (
      (p.input_tokens ?? 0) +
      (p.output_tokens ?? 0) +
      (p.cache_creation_tokens ?? 0) +
      (p.cache_read_tokens ?? 0)
    );
  }

  protected promptBarColor(cost: number): string {
    return cost / this.maxPromptCost() > 0.7 ? 'var(--error)' : 'var(--accent)';
  }

  protected promptFrac(cost: number): number {
    return Math.max(0, Math.min(1, cost / this.maxPromptCost()));
  }

  protected tipSevColor(sev: string): string {
    if (sev === 'error') return 'var(--error)';
    if (sev === 'warn') return 'var(--warn)';
    return 'var(--info)';
  }

  protected tipIcon(tip: { severity: string; icon?: string }): string {
    if (tip.icon) return tip.icon;
    if (tip.severity === 'error') return 'cancel';
    if (tip.severity === 'warn') return 'warn';
    return 'info';
  }
}

// ---------------------------------------------------------------------------
// Seed mini-graph used when the API returns nothing.
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

function layoutCluster(
  items: Array<{ id: string; label: string; sub?: string; kind: string }>,
): CanvasNode[] {
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
