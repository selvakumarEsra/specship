/** Drift queue — filterable list of links in concerning states. */
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ApiService } from '../../api/api';
import { apiResource } from '../../api/resource';
import { ProjectsService } from '../../api/projects';
import { PickProjectEmpty } from '../../shell/pick-project-empty/pick-project-empty';
import type { DriftResponse, SpecLink } from '../../api/types';

type DriftState = 'drifted' | 'broken' | 'orphaned';

@Component({
  selector: 'app-drift',
  imports: [PickProjectEmpty],
  templateUrl: './drift.html',
  styleUrl: './drift.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Drift {
  private readonly api = inject(ApiService);
  private readonly projects = inject(ProjectsService);

  protected readonly stateFilter = signal<Record<DriftState, boolean>>({
    drifted: true, broken: true, orphaned: true,
  });
  protected readonly resource = apiResource<DriftResponse>(
    this.api,
    () => `/api/drift?state=drifted,broken,orphaned${this.projects.projectQuery('&')}`,
  );

  protected readonly allLinks = computed<SpecLink[]>(() => this.resource.state().data?.links ?? []);

  protected readonly visibleLinks = computed<SpecLink[]>(() => {
    const sf = this.stateFilter();
    return this.allLinks().filter((l) => sf[l.state as DriftState]);
  });

  protected readonly counts = computed(() => {
    const counts: Record<DriftState, number> = { drifted: 0, broken: 0, orphaned: 0 };
    for (const l of this.allLinks()) {
      if (l.state in counts) counts[l.state as DriftState]++;
    }
    return counts;
  });

  protected toggleFilter(s: DriftState): void {
    this.stateFilter.update((sf) => ({ ...sf, [s]: !sf[s] }));
  }

  protected ageOf(l: SpecLink): string {
    if (!l.updatedAt) return '';
    const diff = Date.now() - l.updatedAt;
    if (diff < 60_000) return 'just now';
    if (diff < 3_600_000) return Math.round(diff / 60_000) + 'm';
    if (diff < 86_400_000) return Math.round(diff / 3_600_000) + 'h';
    return Math.round(diff / 86_400_000) + 'd';
  }

  protected readonly states: DriftState[] = ['drifted', 'broken', 'orphaned'];
}
