import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ApiService } from '../../api/api';
import { apiResource } from '../../api/resource';
import { ProjectsService } from '../../api/projects';
import type { StatusResponse } from '../../api/types';

@Component({
  selector: 'app-status-strip',
  imports: [],
  templateUrl: './status-strip.html',
  styleUrl: './status-strip.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StatusStrip {
  private readonly api = inject(ApiService);
  private readonly projects = inject(ProjectsService);
  protected readonly status = apiResource<StatusResponse>(this.api, () => `/api/status${this.projects.projectQuery()}`);

  protected readonly indexedLabel = computed(() => {
    const ts = this.status.state().data?.lastIndexed;
    if (!ts) return 'never';
    try {
      const d = new Date(ts);
      const diff = Date.now() - d.getTime();
      if (diff < 60_000) return 'just now';
      if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
      if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
      return d.toLocaleDateString();
    } catch { return String(ts); }
  });

  protected refresh(): void {
    this.status.refetch();
  }
}
