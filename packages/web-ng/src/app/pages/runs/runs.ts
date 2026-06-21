import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from '../../api/api';
import { apiResource } from '../../api/resource';
import { ProjectsService } from '../../api/projects';
import { PickProjectEmpty } from '../../shell/pick-project-empty/pick-project-empty';
import { PageHead } from '../../ui/page-head';
import { StatePill } from '../../ui/state-pill';
import { Segmented, type SegmentedOption } from '../../ui/segmented';
import { Pill } from '../../ui/pill';
import { Icon } from '../../shell/icon/icon';
import { STATE } from '../../ui/state';
import type { RunsResponse, WorkflowRun } from '../../api/types';

@Component({
  selector: 'app-runs',
  imports: [PickProjectEmpty, PageHead, StatePill, Segmented, Pill, Icon],
  templateUrl: './runs.html',
  styleUrl: './runs.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Runs {
  private readonly api = inject(ApiService);
  private readonly projects = inject(ProjectsService);
  private readonly router = inject(Router);

  protected readonly resource = apiResource<RunsResponse>(
    this.api,
    () => `/api/workflows/runs?limit=100${this.projects.projectQuery('&')}`,
  );
  protected readonly allRuns = computed<WorkflowRun[]>(() => this.resource.state().data?.runs ?? []);

  protected readonly statusFilter = signal<string>('all');

  protected readonly filterOptions = computed<SegmentedOption[]>(() => {
    const statuses: WorkflowRun['status'][] = ['running', 'paused', 'completed', 'failed', 'cancelled'];
    return [
      { value: 'all', label: 'All' },
      ...statuses.map((s) => ({ value: s, label: STATE[s]?.label ?? s })),
    ];
  });

  protected readonly runs = computed<WorkflowRun[]>(() => {
    const f = this.statusFilter();
    const all = this.allRuns();
    return f === 'all' ? all : all.filter((r) => r.status === f);
  });

  setFilter(v: string): void {
    this.statusFilter.set(v);
  }

  goToRun(r: WorkflowRun): void {
    void this.router.navigate(['/runs', r.id]);
  }

  protected durationOf(r: WorkflowRun): string {
    if (!r.startedAt) return '—';
    const end = r.completedAt ?? r.lastActivityAt;
    const ms = end - r.startedAt;
    if (ms >= 60_000) return Math.round(ms / 60_000) + 'm ' + Math.round((ms % 60_000) / 1000) + 's';
    if (ms >= 1_000) return Math.round(ms / 1_000) + 's';
    return ms + 'ms';
  }

  protected timeAgo(r: WorkflowRun): string {
    const ts = r.lastActivityAt;
    if (!ts) return '';
    const diff = Date.now() - ts;
    if (diff < 60_000) return 'just now';
    if (diff < 3_600_000) return Math.round(diff / 60_000) + 'm ago';
    if (diff < 86_400_000) return Math.round(diff / 3_600_000) + 'h ago';
    return Math.round(diff / 86_400_000) + 'd ago';
  }

  /** Worktree: derive from metadata.isolationEnvId or isolationEnvId field — API may not expose this. */
  protected worktreeOf(r: WorkflowRun): string {
    const env = r.isolationEnvId ?? (r.metadata?.['isolationEnvId'] as string | undefined);
    return env ?? '—';
  }

  /** Cost — not in API; always '—' for now. */
  protected costOf(_r: WorkflowRun): string { return '—'; }

  /** Artifact count — not in API; always 0. */
  protected artifactsOf(_r: WorkflowRun): number { return 0; }
}
