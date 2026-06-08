import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../api/api';
import { apiResource } from '../../api/resource';
import { ProjectsService } from '../../api/projects';
import { PickProjectEmpty } from '../../shell/pick-project-empty/pick-project-empty';
import type { RunsResponse, WorkflowRun } from '../../api/types';

@Component({
  selector: 'app-runs',
  imports: [RouterLink, PickProjectEmpty],
  templateUrl: './runs.html',
  styleUrl: './runs.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Runs {
  private readonly api = inject(ApiService);
  private readonly projects = inject(ProjectsService);
  protected readonly resource = apiResource<RunsResponse>(this.api, () => `/api/workflows/runs?limit=100${this.projects.projectQuery('&')}`);
  protected readonly runs = computed<WorkflowRun[]>(() => this.resource.state().data?.runs ?? []);

  protected durationOf(r: WorkflowRun): string {
    if (!r.startedAt) return '—';
    const end = r.completedAt ?? r.lastActivityAt;
    const ms = end - r.startedAt;
    if (ms >= 60000) return Math.round(ms / 60000) + 'm ' + Math.round((ms % 60000) / 1000) + 's';
    if (ms >= 1000) return Math.round(ms / 1000) + 's';
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
}
