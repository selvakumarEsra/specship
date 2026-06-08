import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ApiService } from '../../api/api';
import { apiResource } from '../../api/resource';
import { ProjectsService } from '../../api/projects';
import { PickProjectEmpty } from '../../shell/pick-project-empty/pick-project-empty';
import type { Spec, SpecsResponse } from '../../api/types';

interface Group { path: string; title: string; specs: Spec[]; }

@Component({
  selector: 'app-specs',
  imports: [PickProjectEmpty],
  templateUrl: './specs.html',
  styleUrl: './specs.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Specs {
  private readonly api = inject(ApiService);
  private readonly projects = inject(ProjectsService);
  protected readonly resource = apiResource<SpecsResponse>(this.api, () => `/api/specs${this.projects.projectQuery()}`);
  protected readonly sel = signal<string | null>(null);

  protected readonly groups = computed<Group[]>(() => {
    const all = this.resource.state().data?.specs ?? [];
    const map = new Map<string, Group>();
    for (const s of all) {
      const path = s.sourcePath || '(unknown)';
      if (!map.has(path)) map.set(path, { path, title: path.split('/').pop() || path, specs: [] });
      map.get(path)!.specs.push(s);
    }
    return [...map.values()];
  });

  protected readonly selectedSpec = computed<Spec | null>(() => {
    const id = this.sel();
    if (!id) return null;
    for (const g of this.groups()) for (const s of g.specs) if (s.id === id) return s;
    return null;
  });

  protected select(id: string): void { this.sel.set(id); }
}
