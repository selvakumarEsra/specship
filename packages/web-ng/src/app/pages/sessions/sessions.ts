/** Sessions list — sortable, opens detail per row. */
import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ApiService } from '../../api/api';
import { apiResource } from '../../api/resource';
import type { ClaudeSession, SessionsResponse } from '../../api/types';

type Range = 'today' | 'week' | 'month' | 'all';
type Sort = 'cost' | 'prompts';

interface Row {
  id: string;
  fullId: string;
  project: string;
  started: string;
  ended: string;
  prompts: number;
  cost: number;
  cache: number;
  model: string;
}

@Component({
  selector: 'app-sessions',
  imports: [DecimalPipe],
  templateUrl: './sessions.html',
  styleUrl: './sessions.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Sessions {
  private readonly api = inject(ApiService);
  protected readonly range = signal<Range>('all');
  protected readonly sort = signal<Sort>('cost');
  protected readonly ranges: Range[] = ['today', 'week', 'month', 'all'];

  protected readonly resource = apiResource<SessionsResponse>(
    this.api,
    () => `/api/claude/sessions?range=${this.range()}&limit=200`
  );

  protected readonly rows = computed<Row[]>(() => {
    const arr = this.resource.state().data?.sessions ?? [];
    return arr.map((s) => this.adapt(s));
  });

  protected readonly sorted = computed<Row[]>(() => {
    const s = this.sort();
    return [...this.rows()].sort((a, b) => (s === 'cost' ? b.cost - a.cost : b.prompts - a.prompts));
  });

  private adapt(s: ClaudeSession): Row {
    const total = (s.total_input_tokens || 0) + (s.total_cache_creation_tokens || 0) + (s.total_cache_read_tokens || 0);
    return {
      id: (s.id || '').slice(0, 8),
      fullId: s.id,
      project: (s.project_path || '').split('/').filter(Boolean).pop() || '?',
      started: this.fmtTime(s.started_at),
      ended: this.fmtTime(s.ended_at).split(' ').pop() || '',
      prompts: s.prompt_count || 0,
      cost: s.total_cost_usd || 0,
      cache: total > 0 ? (s.total_cache_read_tokens || 0) / total : 0,
      model: s.last_model || 'unknown',
    };
  }

  private fmtTime(ms: number | null | undefined): string {
    if (!ms) return '';
    try {
      const d = new Date(ms);
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const dayMs = 86_400_000;
      const diff = today.getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      if (diff === 0) return 'Today ' + time;
      if (diff === dayMs) return 'Yest ' + time;
      return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + time;
    } catch { return String(ms); }
  }

  protected setSort(s: Sort): void { this.sort.set(s); }
  protected setRange(r: Range): void { this.range.set(r); }

  protected cacheColor(v: number): string {
    return v >= 0.7 ? 'var(--success)' : v >= 0.5 ? 'var(--warn)' : 'var(--error)';
  }
}
