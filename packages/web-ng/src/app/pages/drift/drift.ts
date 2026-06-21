/** Drift queue — filterable list of links in concerning states. */
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from '../../api/api';
import { apiResource } from '../../api/resource';
import { ProjectsService } from '../../api/projects';
import { PickProjectEmpty } from '../../shell/pick-project-empty/pick-project-empty';
import { Icon } from '../../shell/icon/icon';
import { PageHead } from '../../ui/page-head';
import { Empty } from '../../ui/empty';
import { StatePill } from '../../ui/state-pill';
import { Pill } from '../../ui/pill';
import { STATE } from '../../ui/state';
import type { DriftResponse, SpecLink } from '../../api/types';

type DriftState = 'drifted' | 'broken' | 'orphaned';

@Component({
  selector: 'app-drift',
  imports: [PickProjectEmpty, Icon, PageHead, Empty, StatePill, Pill],
  templateUrl: './drift.html',
  styleUrl: './drift.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Drift {
  private readonly api = inject(ApiService);
  private readonly projects = inject(ProjectsService);
  private readonly router = inject(Router);

  protected readonly stateFilter = signal<Record<DriftState, boolean>>({
    drifted: true, broken: true, orphaned: true,
  });

  protected readonly resource = apiResource<DriftResponse>(
    this.api,
    () => `/api/drift?state=drifted,broken,orphaned${this.projects.projectQuery('&')}`,
  );

  /** Rows currently selected (by link.id). */
  protected readonly selected = signal<Set<number>>(new Set());

  /** Which rows are expanded (by link.id). */
  protected readonly expanded = signal<Set<number>>(new Set());

  protected readonly allLinks = computed<SpecLink[]>(() => this.resource.state().data?.links ?? []);

  protected readonly visibleLinks = computed<SpecLink[]>(() => {
    const sf = this.stateFilter();
    return this.allLinks().filter((l) => sf[l.state as DriftState]);
  });

  protected readonly counts = computed<Record<DriftState, number>>(() => {
    const c: Record<DriftState, number> = { drifted: 0, broken: 0, orphaned: 0 };
    for (const l of this.allLinks()) {
      if (l.state in c) c[l.state as DriftState]++;
    }
    return c;
  });

  protected readonly selectedCount = computed(() => this.selected().size);

  protected readonly states: DriftState[] = ['drifted', 'broken', 'orphaned'];

  /** STATE config table — used in template to read .color / .bg per state. */
  protected readonly STATE = STATE;

  protected toggleFilter(s: DriftState): void {
    this.stateFilter.update((sf) => ({ ...sf, [s]: !sf[s] }));
  }

  protected toggleSelect(id: number, e: Event): void {
    e.stopPropagation();
    this.selected.update((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  protected isSelected(id: number): boolean { return this.selected().has(id); }

  protected toggleExpand(id: number): void {
    this.expanded.update((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  protected isExpanded(id: number): boolean { return this.expanded().has(id); }

  protected ageOf(l: SpecLink): string {
    if (!l.updatedAt) return '';
    const diff = Date.now() - l.updatedAt;
    if (diff < 60_000) return 'just now';
    if (diff < 3_600_000) return Math.round(diff / 60_000) + 'm';
    if (diff < 86_400_000) return Math.round(diff / 3_600_000) + 'h';
    return Math.round(diff / 86_400_000) + 'd';
  }

  protected openSpec(specId: string): void {
    this.router.navigate(['/specs'], { queryParams: { sel: specId } });
  }

  protected showInGraph(specId: string): void {
    this.router.navigate(['/graph'], { queryParams: { focus: 'spec:' + specId } });
  }
}
