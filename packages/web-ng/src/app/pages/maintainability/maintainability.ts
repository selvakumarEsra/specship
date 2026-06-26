/**
 * Maintainability page (REQ-MAINT-003.A3).
 *
 * Renders the graph-derived maintainability report — coupling, size hotspots,
 * dependency cycles, dead-code candidates — ranked, each linking to its
 * file/symbol, with the effective thresholds shown.
 */
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ApiService } from '../../api/api';
import { apiResource } from '../../api/resource';
import { ProjectsService } from '../../api/projects';
import { PageHead } from '../../ui/page-head';
import { Pill } from '../../ui/pill';
import { Icon } from '../../shell/icon/icon';
import type { MaintainabilityReport } from '../../api/types';

@Component({
  selector: 'app-maintainability',
  imports: [PageHead, Pill, Icon],
  templateUrl: './maintainability.html',
  styleUrl: './maintainability.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Maintainability {
  private readonly api = inject(ApiService);
  private readonly projects = inject(ProjectsService);
  protected readonly resource = apiResource<MaintainabilityReport>(
    this.api,
    () => `/api/maintainability${this.projects.projectQuery()}`,
  );

  protected readonly report = computed(() => this.resource.state().data);
  protected readonly counts = computed(() => {
    const r = this.resource.state().data;
    return {
      coupling: r?.coupling.length ?? 0,
      oversized: r?.oversized.length ?? 0,
      godFiles: r?.godFiles.length ?? 0,
      cycles: r?.cycles.length ?? 0,
      deadCode: r?.deadCode.length ?? 0,
    };
  });
  protected readonly total = computed(() => {
    const c = this.counts();
    return c.coupling + c.oversized + c.godFiles + c.cycles + c.deadCode;
  });

  protected base(filePath: string): string {
    return filePath.split('/').pop() || filePath;
  }
}
