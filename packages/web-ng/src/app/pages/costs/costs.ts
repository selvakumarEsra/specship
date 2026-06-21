/** Costs — total spend + time-series line + per-model donut + ranked prompts. */
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { ApiService } from '../../api/api';
import { apiResource } from '../../api/resource';
import { LineChart, type LinePoint } from '../../charts/line-chart/line-chart';
import { Donut, type DonutSlice } from '../../charts/donut/donut';
import { PageHead } from '../../ui/page-head';
import { Segmented } from '../../ui/segmented';
import { Delta } from '../../ui/delta';
import { Icon } from '../../shell/icon/icon';
import type { CostsResponse } from '../../api/types';

type Range = 'today' | 'week' | 'month' | 'all';

const COLOR_BY_MODEL: Record<string, string> = {
  'claude-opus-4-7': '#A586F5', 'claude-opus-4': '#A586F5',
  'claude-sonnet-4-6': '#5B93F2', 'claude-sonnet-4-7': '#5B93F2', 'claude-sonnet-4': '#5B93F2',
  'claude-haiku-4-5': '#29D2BE', 'claude-haiku-4': '#29D2BE',
};
const SHORT_BY_MODEL: Record<string, string> = {
  'claude-opus-4-7': 'Opus 4.7', 'claude-opus-4': 'Opus 4',
  'claude-sonnet-4-6': 'Sonnet 4.6', 'claude-sonnet-4-7': 'Sonnet 4.7', 'claude-sonnet-4': 'Sonnet 4',
  'claude-haiku-4-5': 'Haiku 4.5', 'claude-haiku-4': 'Haiku 4',
};

@Component({
  selector: 'app-costs',
  imports: [DecimalPipe, LineChart, Donut, PageHead, Segmented, Delta, Icon],
  templateUrl: './costs.html',
  styleUrl: './costs.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Costs {
  private readonly api = inject(ApiService);
  protected readonly range = signal<Range>('month');
  protected readonly ranges: Range[] = ['today', 'week', 'month', 'all'];
  protected readonly hovered = signal<LinePoint | null>(null);

  protected readonly resource = apiResource<CostsResponse>(
    this.api,
    () => `/api/claude/costs?range=${this.range()}`
  );

  protected readonly series = computed<LinePoint[]>(() => this.resource.state().data?.series ?? []);
  protected readonly topPrompts = computed(() => (this.resource.state().data?.topPrompts ?? []).slice(0, 12));
  protected readonly maxPrompt = computed(() => {
    const arr = this.topPrompts();
    return Math.max(0.01, ...arr.map((p) => p.cost_usd ?? 0));
  });

  protected readonly byModel = computed<DonutSlice[]>(() => {
    const raw = this.resource.state().data?.byModel ?? [];
    return raw.map((m) => ({
      model: m.model,
      short: SHORT_BY_MODEL[m.model] || m.model,
      cost: m.cost || 0,
      color: COLOR_BY_MODEL[m.model] || '#5C6573',
    }));
  });

  protected readonly total = computed(() => this.resource.state().data?.total ?? 0);
  /** Week-over-week spend change (fractional). Hidden for the 'all' range. */
  protected readonly wowDelta = computed(() => this.resource.state().data?.wowDelta ?? 0);

  protected setRange(r: Range): void { this.range.set(r); }
  protected onHover(p: LinePoint | null): void { this.hovered.set(p); }

  protected fmt$(n: number): string {
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  protected fmtK(n: number): string {
    if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k';
    return String(n);
  }
  protected promptTokens(p: { input_tokens?: number; output_tokens?: number; cache_creation_tokens?: number; cache_read_tokens?: number }): number {
    return (p.input_tokens ?? 0) + (p.output_tokens ?? 0) + (p.cache_creation_tokens ?? 0) + (p.cache_read_tokens ?? 0);
  }
  protected cacheRate(p: { input_tokens?: number; cache_creation_tokens?: number; cache_read_tokens?: number }): number {
    const total = (p.input_tokens ?? 0) + (p.cache_creation_tokens ?? 0) + (p.cache_read_tokens ?? 0);
    return total > 0 ? (p.cache_read_tokens ?? 0) / total : 0;
  }
  protected cacheColor(v: number): string {
    return v >= 0.7 ? 'var(--success)' : v >= 0.5 ? 'var(--warn)' : 'var(--error)';
  }
  protected modelShort(model: string | null | undefined): string {
    if (!model) return '?';
    return SHORT_BY_MODEL[model] || model.replace(/^claude-/, '');
  }
  protected percentOf(part: number, total: number): number {
    return total > 0 ? Math.round((part / total) * 100) : 0;
  }
}
