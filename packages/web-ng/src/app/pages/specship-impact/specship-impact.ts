/** SpecShip Impact — token spend vs estimated savings from SpecShip tool usage. */
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { ApiService } from '../../api/api';
import { apiResource } from '../../api/resource';
import { ProjectsService } from '../../api/projects';
import { LineChart, type LinePoint } from '../../charts/line-chart/line-chart';
import { PageHead } from '../../ui/page-head';
import { Segmented } from '../../ui/segmented';
import { Icon } from '../../shell/icon/icon';
import type { SpecshipImpactResponse } from '../../api/types';

type Range = 'today' | 'week' | 'month' | 'all';

@Component({
  selector: 'app-specship-impact',
  imports: [DecimalPipe, LineChart, PageHead, Segmented, Icon],
  templateUrl: './specship-impact.html',
  styleUrl: './specship-impact.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SpecshipImpact {
  private readonly api = inject(ApiService);
  private readonly projects = inject(ProjectsService);

  protected readonly range = signal<Range>('month');
  protected readonly ranges: Range[] = ['today', 'week', 'month', 'all'];
  protected readonly hoveredSpend = signal<LinePoint | null>(null);
  protected readonly hoveredSaved = signal<LinePoint | null>(null);

  protected readonly resource = apiResource<SpecshipImpactResponse>(
    this.api,
    () => `/api/claude/specship-impact?range=${this.range()}${this.projects.projectQuery('&')}`,
  );

  // ---- Derived state --------------------------------------------------------

  protected readonly data = computed(() => this.resource.state().data);

  protected readonly spendTokens = computed(() => this.data()?.spendTokens ?? 0);
  protected readonly spendCostUsd = computed(() => this.data()?.spendCostUsd ?? 0);
  protected readonly savedTokens = computed(() => this.data()?.savedTokens ?? 0);
  protected readonly savedCostUsd = computed(() => this.data()?.savedCostUsd ?? 0);
  protected readonly netTokens = computed(() => this.data()?.netTokens ?? 0);
  protected readonly netCostUsd = computed(() => this.data()?.netCostUsd ?? 0);
  protected readonly overheadTokens = computed(() => this.data()?.overheadTokens ?? 0);
  protected readonly unresolvedCalls = computed(() => this.data()?.unresolvedCalls ?? 0);
  protected readonly totalCalls = computed(() => this.data()?.totalSpecshipCalls ?? 0);
  protected readonly resolvedCalls = computed(() => this.totalCalls() - this.unresolvedCalls());

  protected readonly byTool = computed(() => this.data()?.byTool ?? []);
  protected readonly byProject = computed(() => this.data()?.byProject ?? []);

  /**
   * Split retrieval from governance (REQ-DASHUX-001): retrieval tools are
   * the ones savings estimates apply to; link asserts/verifies, spec reads,
   * designer calls etc. are bookkeeping — real spend, but not what the
   * "does retrieval pay for itself" question is about.
   */
  private static readonly RETRIEVAL_TOOL_RE =
    /specship_(explore|search|node|callers|callees|impact|files|status|trace)$/;

  protected readonly retrievalSpendTokens = computed(() =>
    this.byTool()
      .filter((t) => SpecshipImpact.RETRIEVAL_TOOL_RE.test(t.tool))
      .reduce((s, t) => s + t.spendTokens, 0),
  );
  protected readonly governanceSpendTokens = computed(() =>
    Math.max(0, this.spendTokens() - this.retrievalSpendTokens()),
  );
  /** Saved − retrieval spend: the page's headline ROI. */
  protected readonly retrievalNetTokens = computed(
    () => this.savedTokens() - this.retrievalSpendTokens(),
  );

  /** Trend mapped to LinePoint shape for the spend series. */
  protected readonly spendSeries = computed<LinePoint[]>(() =>
    (this.data()?.trend ?? []).map((t, i) => ({ day: i + 1, cost: t.spendTokens / 1000, prompts: 0 })),
  );

  /** Trend mapped to LinePoint shape for the saved series. */
  protected readonly savedSeries = computed<LinePoint[]>(() =>
    (this.data()?.trend ?? []).map((t, i) => ({ day: i + 1, cost: t.savedTokens / 1000, prompts: 0 })),
  );

  protected readonly isEmpty = computed(() => this.totalCalls() === 0 && !this.resource.state().loading);

  // ---- Helpers --------------------------------------------------------------

  protected setRange(r: Range): void { this.range.set(r); }
  protected onHoverSpend(p: LinePoint | null): void { this.hoveredSpend.set(p); }
  protected onHoverSaved(p: LinePoint | null): void { this.hoveredSaved.set(p); }

  protected fmt$(n: number): string {
    const sign = n < 0 ? '-' : '';
    return sign + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  /**
   * Compact token count. Abbreviates the MAGNITUDE and preserves the sign —
   * the old version fell through to String(n) for negatives, rendering the
   * net tile as a raw `-971752` (REQ-DASHINT-002.A3).
   */
  protected fmtK(n: number): string {
    const sign = n < 0 ? '-' : '';
    const abs = Math.abs(n);
    if (abs >= 1_000_000) return sign + (abs / 1_000_000).toFixed(1) + 'M';
    if (abs >= 1000) return sign + (abs / 1000).toFixed(abs >= 10_000 ? 0 : 1) + 'k';
    return sign + String(abs);
  }
}
