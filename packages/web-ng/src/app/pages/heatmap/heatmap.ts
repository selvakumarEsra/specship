/**
 * Heatmap — files grid + tools/subagents bars + click-to-drill side drawer.
 *
 * The aggregate heatmap is one fetch; each cell/row is clickable and opens
 * a side drawer that hits the matching /api/claude/heatmap/{file,tool,subagent}
 * endpoint for the underlying invocations.
 */
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ApiService } from '../../api/api';
import { apiResource } from '../../api/resource';
import { HBars, type HBarItem } from '../../charts/h-bars/h-bars';
import type {
  HeatmapResponse,
  HeatmapFileDrillResponse,
  HeatmapToolDrillResponse,
  HeatmapSubagentDrillResponse,
} from '../../api/types';

type Range = 'today' | 'week' | 'month' | 'all';

type DrillTarget =
  | { kind: 'file'; key: string }
  | { kind: 'tool'; key: string }
  | { kind: 'subagent'; key: string };

@Component({
  selector: 'app-heatmap',
  imports: [HBars],
  templateUrl: './heatmap.html',
  styleUrl: './heatmap.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Heatmap {
  private readonly api = inject(ApiService);
  protected readonly range = signal<Range>('week');
  protected readonly ranges: Range[] = ['today', 'week', 'month', 'all'];

  protected readonly resource = apiResource<HeatmapResponse>(
    this.api,
    () => `/api/claude/heatmap?range=${this.range()}`
  );

  protected readonly files = computed(() => this.resource.state().data?.files ?? []);
  protected readonly tools = computed(() => this.resource.state().data?.tools ?? []);
  protected readonly subagents = computed(() => this.resource.state().data?.subagents ?? []);
  protected readonly subagentByName = computed(() => this.resource.state().data?.subagentByName ?? []);
  protected readonly maxFile = computed(() => Math.max(1, ...this.files().map((f) => f.calls)));
  protected readonly maxSubagentCalls = computed(() => Math.max(1, ...this.subagentByName().map((s) => s.calls)));

  // Drill drawer ------------------------------------------------------------

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
    if (d.kind === 'file') return d.key;
    if (d.kind === 'tool') return d.key + ' calls';
    return d.key + ' subagent';
  });

  protected readonly drillLoading = computed(() => {
    const d = this.drill();
    if (!d) return false;
    if (d.kind === 'file') return this.fileDrill.state().loading;
    if (d.kind === 'tool') return this.toolDrill.state().loading;
    return this.subagentDrill.state().loading;
  });

  // Actions -----------------------------------------------------------------

  protected setRange(r: Range): void { this.range.set(r); }

  protected openFile(path: string): void { this.drill.set({ kind: 'file', key: path }); }
  protected openTool(it: HBarItem): void { this.drill.set({ kind: 'tool', key: it.name }); }
  protected openSubagent(name: string): void { this.drill.set({ kind: 'subagent', key: name }); }
  protected closeDrill(): void { this.drill.set(null); }

  // Formatters --------------------------------------------------------------

  protected fileBg(calls: number): string {
    const t = calls / this.maxFile();
    return `color-mix(in srgb, var(--warn) ${Math.round(15 + t * 72)}%, var(--bg-elevated))`;
  }
  protected fileColor(calls: number): string {
    return calls / this.maxFile() > 0.5 ? '#fff' : 'var(--text-secondary)';
  }

  protected subagentBarFrac(calls: number): number {
    return Math.max(0, Math.min(1, calls / this.maxSubagentCalls()));
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

  protected truncate(s: string, n = 120): string {
    return s.length > n ? s.slice(0, n) + '…' : s;
  }
}
