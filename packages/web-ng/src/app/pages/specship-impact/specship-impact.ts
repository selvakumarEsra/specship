/** SpecShip Impact — token spend vs estimated savings from SpecShip tool usage. */
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { ApiService } from '../../api/api';
import { apiResource } from '../../api/resource';
import { ProjectsService } from '../../api/projects';
import { LineChart, type LinePoint } from '../../charts/line-chart/line-chart';
import { PageHead } from '../../ui/page-head';
import { Segmented } from '../../ui/segmented';
import { Delta } from '../../ui/delta';
import { Icon } from '../../shell/icon/icon';
import type { SpecshipImpactResponse } from '../../api/types';

type Range = 'today' | 'week' | 'month' | 'all';

@Component({
  selector: 'app-specship-impact',
  imports: [DecimalPipe, LineChart, PageHead, Segmented, Delta, Icon],
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

  /** Trend mapped to LinePoint shape for the spend series. */
  protected readonly spendSeries = computed<LinePoint[]>(() =>
    (this.data()?.trend ?? []).map((t, i) => ({ day: i + 1, cost: t.spendTokens / 1000, prompts: 0 })),
  );

  /** Trend mapped to LinePoint shape for the saved series. */
  protected readonly savedSeries = computed<LinePoint[]>(() =>
    (this.data()?.trend ?? []).map((t, i) => ({ day: i + 1, cost: t.savedTokens / 1000, prompts: 0 })),
  );

  /** Net delta as a fraction (saved / spend). Positive = net positive. */
  protected readonly netDelta = computed(() => {
    const spend = this.spendTokens();
    const saved = this.savedTokens();
    if (spend === 0) return 0;
    return (saved - spend) / spend;
  });

  protected readonly isEmpty = computed(() => this.totalCalls() === 0 && !this.resource.state().loading);

  // ---- Helpers --------------------------------------------------------------

  protected setRange(r: Range): void { this.range.set(r); }
  protected onHoverSpend(p: LinePoint | null): void { this.hoveredSpend.set(p); }
  protected onHoverSaved(p: LinePoint | null): void { this.hoveredSaved.set(p); }

  protected fmt$(n: number): string {
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  protected fmtK(n: number): string {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(n >= 10_000 ? 0 : 1) + 'k';
    return String(n);
  }
}
