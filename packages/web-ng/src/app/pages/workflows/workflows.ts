import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ApiService } from '../../api/api';
import { apiResource } from '../../api/resource';
import { ProjectsService } from '../../api/projects';
import { PickProjectEmpty } from '../../shell/pick-project-empty/pick-project-empty';
import { PageHead } from '../../ui/page-head';
import { Pill } from '../../ui/pill';
import { Icon } from '../../shell/icon/icon';
import { RunModal } from './run-modal';
import type { WorkflowDef, WorkflowEntry, WorkflowsResponse } from '../../api/types';

@Component({
  selector: 'app-workflows',
  imports: [PickProjectEmpty, PageHead, Pill, Icon, RunModal],
  templateUrl: './workflows.html',
  styleUrl: './workflows.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Workflows {
  private readonly api = inject(ApiService);
  private readonly projects = inject(ProjectsService);

  protected readonly resource = apiResource<WorkflowsResponse>(
    this.api,
    () => `/api/workflows${this.projects.projectQuery()}`,
  );
  protected readonly entries = computed<WorkflowEntry[]>(
    () => this.resource.state().data?.workflows ?? [],
  );

  /** The workflow whose launch modal is open, or null. */
  protected readonly runTarget = signal<WorkflowDef | null>(null);

  protected openRun(wf: WorkflowDef): void {
    this.runTarget.set(wf);
  }
  protected closeRun(): void {
    this.runTarget.set(null);
  }

  readonly scopeColor: Record<string, string> = {
    bundled: 'var(--node-spec)',
    global: 'var(--node-code)',
    project: 'var(--node-route)',
  };
  readonly scopeBg: Record<string, string> = {
    bundled: 'color-mix(in srgb, var(--node-spec) 14%, transparent)',
    global: 'color-mix(in srgb, var(--node-code) 14%, transparent)',
    project: 'color-mix(in srgb, var(--node-route) 14%, transparent)',
  };
}
