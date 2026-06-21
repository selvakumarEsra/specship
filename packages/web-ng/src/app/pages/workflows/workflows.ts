import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ApiService } from '../../api/api';
import { apiResource } from '../../api/resource';
import { ProjectsService } from '../../api/projects';
import { Router } from '@angular/router';
import { PickProjectEmpty } from '../../shell/pick-project-empty/pick-project-empty';
import { PageHead } from '../../ui/page-head';
import { Pill } from '../../ui/pill';
import { Icon } from '../../shell/icon/icon';
import type { WorkflowEntry, WorkflowsResponse } from '../../api/types';

@Component({
  selector: 'app-workflows',
  imports: [PickProjectEmpty, PageHead, Pill, Icon],
  templateUrl: './workflows.html',
  styleUrl: './workflows.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Workflows {
  private readonly api = inject(ApiService);
  private readonly projects = inject(ProjectsService);
  private readonly router = inject(Router);

  protected readonly resource = apiResource<WorkflowsResponse>(
    this.api,
    () => `/api/workflows${this.projects.projectQuery()}`,
  );
  protected readonly entries = computed<WorkflowEntry[]>(
    () => this.resource.state().data?.workflows ?? [],
  );

  /** Currently open modal workflow entry (null = closed) */
  protected readonly modalEntry = signal<WorkflowEntry | null>(null);
  /** Input values for the modal form */
  protected readonly modalVals = signal<Record<string, string>>({});

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

  openModal(e: WorkflowEntry): void {
    this.modalVals.set({});
    this.modalEntry.set(e);
  }

  closeModal(): void {
    this.modalEntry.set(null);
  }

  setVal(name: string, value: string): void {
    this.modalVals.update((v) => ({ ...v, [name]: value }));
  }

  async launchRun(): Promise<void> {
    const entry = this.modalEntry();
    if (!entry) return;
    this.closeModal();
    // Navigate to runs list — the server creates the run and the list will refresh
    void this.router.navigate(['/runs']);
  }
}
