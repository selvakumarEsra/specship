import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ApiService } from '../../api/api';
import { apiResource } from '../../api/resource';
import { ProjectsService } from '../../api/projects';
import { PickProjectEmpty } from '../../shell/pick-project-empty/pick-project-empty';
import type { WorkflowEntry, WorkflowsResponse } from '../../api/types';

@Component({
  selector: 'app-workflows',
  imports: [PickProjectEmpty],
  templateUrl: './workflows.html',
  styleUrl: './workflows.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Workflows {
  private readonly api = inject(ApiService);
  private readonly projects = inject(ProjectsService);
  protected readonly resource = apiResource<WorkflowsResponse>(this.api, () => `/api/workflows${this.projects.projectQuery()}`);
  protected readonly entries = computed<WorkflowEntry[]>(() => this.resource.state().data?.workflows ?? []);
}
