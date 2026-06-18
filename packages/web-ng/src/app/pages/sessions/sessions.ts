/** Sessions list — sortable, opens detail per row. */
import { DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../api/api';
import { apiResource } from '../../api/resource';
import { ProjectsService } from '../../api/projects';
import { RefreshService } from '../../api/refresh';
import { Icon } from '../../shell/icon/icon';
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

/**
 * Auto-refresh interval (ms) while the tab is visible. Sessions data is the
 * dashboard's most-live surface — users expect the list to show the session
 * they just ran without an explicit page reload. 10 s is fast enough that a
 * just-finished session shows up by the time the user navigates here, slow
 * enough that the background fetches don't add meaningful load. Paused
 * automatically when the document isn't visible (Page Visibility API).
 */
const AUTO_REFRESH_MS = 10_000;

@Component({
  selector: 'app-sessions',
  imports: [DecimalPipe, RouterLink, Icon],
  templateUrl: './sessions.html',
  styleUrl: './sessions.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Sessions {
  private readonly api = inject(ApiService);
  private readonly projects = inject(ProjectsService);
  protected readonly refresh = inject(RefreshService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly range = signal<Range>('all');
  protected readonly sort = signal<Sort>('cost');
  protected readonly ranges: Range[] = ['today', 'week', 'month', 'all'];
  protected readonly localRefreshing = signal(false);

  /**
   * The URL passes `range` AND the active project slug. Without the
   * `project=` param, the server falls back to the boot-time primary
   * project — which is why the list looked stale to users running
   * Claude Code against multiple projects: they were seeing the wrong
   * project's sessions, not stale data per se.
   */
  protected readonly resource = apiResource<SessionsResponse>(
    this.api,
    () => `/api/claude/sessions?range=${this.range()}&limit=200${this.projects.projectQuery('&')}`,
  );

  protected readonly rows = computed<Row[]>(() => {
    const arr = this.resource.state().data?.sessions ?? [];
    return arr.map((s) => this.adapt(s));
  });

  protected readonly sorted = computed<Row[]>(() => {
    const s = this.sort();
    return [...this.rows()].sort((a, b) => (s === 'cost' ? b.cost - a.cost : b.prompts - a.prompts));
  });

  constructor() {
    // Auto-refresh while the tab is visible. Bumps the resource's local
    // trigger only (not the global tick) so it doesn't fan out to every
    // surface on every interval — the global refresh button is still
    // the explicit "everything" path.
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (intervalId !== null) return;
      intervalId = setInterval(() => {
        if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
          this.resource.refetch();
        }
      }, AUTO_REFRESH_MS);
    };
    const stop = () => {
      if (intervalId !== null) { clearInterval(intervalId); intervalId = null; }
    };
    const visibilityHandler = () => {
      if (typeof document === 'undefined') return;
      if (document.visibilityState === 'visible') {
        // Returning to the tab — force an immediate refetch so the
        // user doesn't have to wait up to AUTO_REFRESH_MS for the
        // next interval tick.
        this.resource.refetch();
      }
    };

    start();
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', visibilityHandler);
    }
    this.destroyRef.onDestroy(() => {
      stop();
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', visibilityHandler);
      }
    });

    // Clear the localRefreshing flag once a triggered fetch completes.
    effect(() => {
      const loading = this.resource.state().loading;
      if (!loading && this.localRefreshing()) this.localRefreshing.set(false);
    });
  }

  /**
   * Per-page refresh button. Force-runs the server-side
   * sync+ingest via the global refresh (so the SQL underneath updates
   * to whatever JSONL transcripts the watcher caught after the last
   * tick). This is the same thing the status-strip ↻ does — wired here
   * too because users expect the action to be at hand on the Sessions
   * page itself, not in the page chrome.
   */
  protected async forceRefresh(): Promise<void> {
    this.localRefreshing.set(true);
    await this.refresh.triggerGlobalRefresh();
    // The global tick fans out to apiResource which refetches; the
    // localRefreshing flag clears via the effect above once the
    // resource flips back to loading=false.
  }

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
