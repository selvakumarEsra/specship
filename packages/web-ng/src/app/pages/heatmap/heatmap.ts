/**
 * Heatmap — treemap + tool efficiency table + subagents + click-to-drill side drawer.
 */
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { ApiService } from '../../api/api';
import { apiResource } from '../../api/resource';
import { shortLabel } from '../../util/paths';
import { PageHead } from '../../ui/page-head';
import { Segmented } from '../../ui/segmented';
import { Bar } from '../../ui/bar';
import { HBars, type HBarItem } from '../../charts/h-bars/h-bars';
import { Treemap, type TreemapItem } from '../../charts/treemap/treemap';
import { Sparkline } from '../../charts/sparkline/sparkline';
import { Icon } from '../../shell/icon/icon';
import type {
  HeatmapResponse,
  HeatmapFileDrillResponse,
  HeatmapToolDrillResponse,
  HeatmapSubagentDrillResponse,
} from '../../api/types';

type Range = 'today' | 'week' | 'month' | 'all';
type Metric = 'calls' | 'tokens';

type DrillTarget =
  | { kind: 'file'; key: string }
  | { kind: 'tool'; key: string }
  | { kind: 'subagent'; key: string };

@Component({
  selector: 'app-heatmap',
  imports: [PageHead, Segmented, Bar, HBars, Treemap, Sparkline, Icon, DecimalPipe],
  templateUrl: './heatmap.html',
  styleUrl: './heatmap.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Heatmap {
  protected readonly Math = Math;

  private readonly api = inject(ApiService);
  protected readonly range = signal<Range>('week');
  protected readonly metric = signal<Metric>('calls');

  protected readonly resource = apiResource<HeatmapResponse>(
    this.api,
    () => `/api/claude/heatmap?range=${this.range()}`
  );

  protected readonly files = computed(() => this.resource.state().data?.files ?? []);
  protected readonly tools = computed(() => this.resource.state().data?.tools ?? []);
  protected readonly subagents = computed(() => this.resource.state().data?.subagents ?? []);
  protected readonly subagentByName = computed(() => this.resource.state().data?.subagentByName ?? []);

  // Summary stats
  protected readonly totalCalls = computed(() => this.tools().reduce((a, b) => a + b.calls, 0));
  protected readonly totalResultTokens = computed(() => this.tools().reduce((a, b) => a + (b.resultBytes || 0), 0));
  protected readonly busiestFile = computed<HeatmapResponse['files'][number] | null>(
    () => [...this.files()].sort((a, b) => b.calls - a.calls)[0] ?? null,
  );
  protected readonly heaviestTool = computed<HeatmapResponse['tools'][number] | null>(
    () => [...this.tools()].sort((a, b) => (b.resultBytes || 0) - (a.resultBytes || 0))[0] ?? null,
  );

  // Tool table sorted by result tokens
  protected readonly toolsByTokens = computed(() => [...this.tools()].sort((a, b) => (b.resultBytes || 0) - (a.resultBytes || 0)));
  protected readonly maxToolTokens = computed(() => Math.max(1, ...this.toolsByTokens().map((t) => t.resultBytes || 0)));

  // Treemap items — area = metric value, intensity = tokens/call.
  // Cap to the top files by the selected metric so cells stay tile-sized and
  // readable (a long tail of 1-call files otherwise renders as slivers).
  protected readonly treemapItems = computed<TreemapItem[]>(() => {
    const m = this.metric();
    const valueOf = (f: { calls: number; resultBytes: number }) =>
      m === 'tokens' ? (f.resultBytes || 0) : f.calls;
    const files = [...this.files()].sort((a, b) => valueOf(b) - valueOf(a)).slice(0, 48);
    if (!files.length) return [];
    const maxTpc = Math.max(1, ...files.map((f) => (f.resultBytes || 0) / Math.max(1, f.calls)));
    return files.map((f) => {
      const tpc = (f.resultBytes || 0) / Math.max(1, f.calls);
      return {
        key: f.path,
        label: shortLabel(f.path),
        value: valueOf(f),
        intensity: tpc / maxTpc,
        sub: m === 'tokens' ? this.fmtTokens(f.resultBytes || 0) : f.calls + ' calls',
        title: `${f.path}\n${f.calls} calls · ${this.fmtTokens(f.resultBytes || 0)} result tokens · ${this.fmtTokens(Math.round(tpc))}/call`,
      };
    });
  });

  // Drill drawer
  protected readonly drill = signal<DrillTarget | null>(null);

  protected readonly fileDrill = apiResource<HeatmapFileDrillResponse>(this.api, () => {
    const d = this.drill();
    return d?.kind === 'file' ? `/api/claude/heatmap/file?path=${encodeURIComponent(d.key)}&range=${this.range()}` : null;
  });
  protected readonly toolDrill = apiResource<HeatmapToolDrillResponse>(this.api, () => {
    const d = this.drill();
    return d?.kind === 'tool' ? `/api/claude/heatmap/tool?name=${encodeURIComponent(d.key)}&range=${this.range()}` : null;
  });
  protected readonly subagentDrill = apiResource<HeatmapSubagentDrillResponse>(this.api, () => {
    const d = this.drill();
    return d?.kind === 'subagent' ? `/api/claude/heatmap/subagent?type=${encodeURIComponent(d.key)}&range=${this.range()}` : null;
  });

  protected readonly drillTitle = computed(() => {
    const d = this.drill();
    if (!d) return '';
    return d.key;
  });

  protected readonly drillLoading = computed(() => {
    const d = this.drill();
    if (!d) return false;
    if (d.kind === 'file') return this.fileDrill.state().loading;
    if (d.kind === 'tool') return this.toolDrill.state().loading;
    return this.subagentDrill.state().loading;
  });

  // Actions
  protected setRange(r: Range): void { this.range.set(r); }
  protected setMetric(m: Metric): void { this.metric.set(m); }
  protected openFile(path: string): void { this.drill.set({ kind: 'file', key: path }); }
  protected openToolByName(name: string): void { this.drill.set({ kind: 'tool', key: name }); }
  protected openSubagent(name: string): void { this.drill.set({ kind: 'subagent', key: name }); }
  protected closeDrill(): void { this.drill.set(null); }

  // Returns the real 7-day call trend for a file path, or [] if not available.
  protected fileTrendFor(path: string): number[] {
    return this.files().find((f) => f.path === path)?.trend ?? [];
  }

  // Helper to sum calls across file sessions
  protected fileTotalCalls(sessions: Array<{ calls: number }>): number {
    return sessions.reduce((a, s) => a + s.calls, 0);
  }

  // Efficiency color: red if >20k/call, warn >8k, success lean
  protected effColor(tpc: number): string {
    return tpc > 20000 ? 'var(--error)' : tpc > 8000 ? 'var(--warn)' : 'var(--success)';
  }

  protected fmtTokens = (n: number): string => {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(0) + 'k';
    return String(n);
  };

  protected fmtBytes(n: number): string {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'MB';
    if (n >= 1000) return (n / 1000).toFixed(0) + 'kB';
    return n + 'B';
  }

  protected timeAgo(ts: number): string {
    const diff = Date.now() - ts;
    if (diff < 60_000) return 'just now';
    if (diff < 3_600_000) return Math.round(diff / 60_000) + 'm ago';
    if (diff < 86_400_000) return Math.round(diff / 3_600_000) + 'h ago';
    return Math.round(diff / 86_400_000) + 'd ago';
  }

  protected shortId(id: string): string { return id.slice(0, 8); }
  /** Last two path segments — readable file label for the summary card. */
  protected shortFile(p: string | undefined | null): string {
    if (!p) return '—';
    const segs = p.split('/').filter(Boolean);
    return segs.slice(-2).join('/') || p;
  }
  protected truncate(s: string, n = 120): string { return s.length > n ? s.slice(0, n) + '…' : s; }
}
