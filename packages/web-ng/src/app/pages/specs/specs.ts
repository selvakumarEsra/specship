import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ApiService } from '../../api/api';
import { apiResource } from '../../api/resource';
import { ProjectsService } from '../../api/projects';
import { PickProjectEmpty } from '../../shell/pick-project-empty/pick-project-empty';
import { Icon } from '../../shell/icon/icon';
import { SpecEditor } from '../../components/spec-editor/spec-editor';
import { DraftWithClaudeModal } from '../../components/draft-with-claude-modal/draft-with-claude-modal';
import type { Spec, SpecsResponse } from '../../api/types';

interface Group { path: string; title: string; specs: Spec[]; }

/** Shape returned by GET /api/spec/:id after the v0.2 `source` extension. */
interface SpecDetailResponse {
  spec: Spec;
  source: string | null;
}

@Component({
  selector: 'app-specs',
  imports: [PickProjectEmpty, Icon, SpecEditor, DraftWithClaudeModal],
  templateUrl: './specs.html',
  styleUrl: './specs.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Specs {
  private readonly api = inject(ApiService);
  private readonly projects = inject(ProjectsService);
  protected readonly resource = apiResource<SpecsResponse>(this.api, () => `/api/specs${this.projects.projectQuery()}`);
  protected readonly sel = signal<string | null>(null);

  /** True when the user clicked Edit and Monaco is active for the selected spec. */
  protected readonly editing = signal(false);
  /** Latest source content fetched from /api/spec/:id (or null while loading). */
  protected readonly editingSource = signal<string | null>(null);
  protected readonly editingDirty = signal(false);
  protected readonly saving = signal(false);
  protected readonly saveError = signal<string | null>(null);

  protected readonly draftModalOpen = signal(false);

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

  protected select(id: string): void {
    // Switching specs while editing discards the edit — explicit cancel
    // is required to preserve dirty state.
    if (this.editing()) {
      this.editing.set(false);
      this.editingSource.set(null);
      this.editingDirty.set(false);
    }
    this.sel.set(id);
  }

  /** Enter edit mode for the currently-selected spec. Fetches the source file. */
  protected async onEditClick(): Promise<void> {
    const spec = this.selectedSpec();
    if (!spec) return;
    this.saveError.set(null);
    this.editing.set(true);
    this.editingSource.set(null);
    try {
      const projectQs = this.projects.projectQuery();
      const detail = await this.api.get<SpecDetailResponse>(`/api/spec/${encodeURIComponent(spec.id)}${projectQs}`);
      this.editingSource.set(detail.source ?? '');
    } catch (e) {
      this.saveError.set(`Couldn't load source: ${e instanceof Error ? e.message : String(e)}`);
      this.editing.set(false);
    }
  }

  protected onEditorValueChange(next: string): void {
    const orig = this.editingSource() ?? '';
    this.editingDirty.set(next !== orig);
    // Also stash the latest so Save knows what to PUT — re-use the same
    // signal since the editor is the source of truth while editing.
    this.editingSource.set(next);
    // Re-derive dirty so the Save button gates correctly even after we
    // updated editingSource above.
    this.editingDirty.set(true);
  }

  protected async onEditorSave(): Promise<void> {
    const spec = this.selectedSpec();
    const content = this.editingSource();
    if (!spec || content === null) return;
    this.saving.set(true);
    this.saveError.set(null);
    try {
      const projectQs = this.projects.projectQuery();
      await this.api.put<{ ok: boolean }>(`/api/spec/${encodeURIComponent(spec.id)}${projectQs}`, { content });
      this.editing.set(false);
      this.editingDirty.set(false);
      this.editingSource.set(null);
      this.resource.refetch();
    } catch (e) {
      this.saveError.set(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.saving.set(false);
    }
  }

  protected onEditorCancel(): void {
    if (this.editingDirty() && !window.confirm('Discard unsaved changes?')) return;
    this.editing.set(false);
    this.editingSource.set(null);
    this.editingDirty.set(false);
    this.saveError.set(null);
  }

  // ---- Draft-with-Claude modal ------------------------------------------
  protected onDraftWithClaudeClick(): void { this.draftModalOpen.set(true); }
  protected onDraftModalClose(): void { this.draftModalOpen.set(false); }
}
