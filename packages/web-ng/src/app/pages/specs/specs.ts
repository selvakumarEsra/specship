import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from '../../api/api';
import { apiResource } from '../../api/resource';
import { ProjectsService } from '../../api/projects';
import { PickProjectEmpty } from '../../shell/pick-project-empty/pick-project-empty';
import { Icon } from '../../shell/icon/icon';
import { SpecEditor } from '../../components/spec-editor/spec-editor';
import { DraftWithClaudeModal } from '../../components/draft-with-claude-modal/draft-with-claude-modal';
import { Empty } from '../../ui/empty';
import { StatePill } from '../../ui/state-pill';
import { Pill } from '../../ui/pill';
import { CopyBtn } from '../../ui/copy-btn';
import { STATE } from '../../ui/state';
import type { Spec, SpecsResponse, SpecDetailResponse, SpecLink } from '../../api/types';

interface Group { path: string; title: string; specs: Spec[]; }

/** Minimal inline markdown: bold + backtick code. */
function mdInline(s: string): string {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/\*\*(.+?)\*\*/g, "<strong style='color:var(--text-primary)'>$1</strong>")
    .replace(/`(.+?)`/g, "<code class='mono' style='font-size:12px;background:var(--bg-canvas);padding:1px 5px;border-radius:4px;border:1px solid var(--border-subtle)'>$1</code>");
}

@Component({
  selector: 'app-specs',
  imports: [
    PickProjectEmpty, Icon, SpecEditor, DraftWithClaudeModal,
    Empty, StatePill, Pill, CopyBtn,
  ],
  templateUrl: './specs.html',
  styleUrl: './specs.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Specs {
  private readonly api = inject(ApiService);
  private readonly projects = inject(ProjectsService);
  private readonly router = inject(Router);

  protected readonly resource = apiResource<SpecsResponse>(
    this.api,
    () => `/api/specs${this.projects.projectQuery()}`,
  );

  /** Fetches links + siblings for the selected spec. */
  protected readonly detailResource = apiResource<SpecDetailResponse>(
    this.api,
    () => {
      const id = this.sel();
      if (!id) return null;
      return `/api/spec/${encodeURIComponent(id)}${this.projects.projectQuery()}`;
    },
  );

  protected readonly sel = signal<string | null>(null);
  /** Tracks which doc groups are manually collapsed (key = 'closed:' + path). */
  protected readonly expandedGroups = signal<Set<string>>(new Set());

  protected readonly editing = signal(false);
  protected readonly editingSource = signal<string | null>(null);
  protected readonly editingDirty = signal(false);
  protected readonly saving = signal(false);
  protected readonly saveError = signal<string | null>(null);
  protected readonly draftModalOpen = signal(false);

  protected readonly STATE = STATE;

  protected readonly groups = computed<Group[]>(() => {
    const all = this.resource.state().data?.specs ?? [];
    const map = new Map<string, Group>();
    for (const s of all) {
      const path = s.sourcePath || '(unknown)';
      if (!map.has(path)) map.set(path, { path, title: path.replace(/^specs\//, ''), specs: [] });
      map.get(path)!.specs.push(s);
    }
    return [...map.values()];
  });

  protected readonly totalCount = computed(() =>
    this.groups().reduce((n, g) => n + g.specs.length, 0),
  );

  protected readonly selectedSpec = computed<Spec | null>(() => {
    const id = this.sel();
    if (!id) return null;
    for (const g of this.groups()) for (const s of g.specs) if (s.id === id) return s;
    return null;
  });

  protected readonly selectedLinks = computed<SpecLink[]>(
    () => this.detailResource.state().data?.links ?? [],
  );

  protected readonly selectedSiblings = computed<Spec[]>(() => {
    const cur = this.selectedSpec();
    if (!cur) return [];
    const g = this.groups().find((gr) => gr.path === cur.sourcePath);
    return g ? g.specs.filter((s) => s.id !== cur.id) : [];
  });

  protected isGroupOpen(path: string): boolean {
    return !this.expandedGroups().has('closed:' + path);
  }

  protected toggleGroup(path: string): void {
    this.expandedGroups.update((s) => {
      const key = 'closed:' + path;
      const next = new Set(s);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  /** Drift badge count for a doc group — only meaningful for the selected group. */
  protected driftCountForGroup(g: Group): number {
    const cur = this.selectedSpec();
    if (!cur || cur.sourcePath !== g.path) return 0;
    return this.selectedLinks().filter((l) =>
      ['drifted', 'broken', 'orphaned'].includes(l.state),
    ).length;
  }

  protected stateColorFor(state: string): string {
    return STATE[state]?.color ?? 'var(--node-spec)';
  }

  protected select(id: string): void {
    if (this.editing()) {
      this.editing.set(false);
      this.editingSource.set(null);
      this.editingDirty.set(false);
    }
    this.sel.set(id);
  }

  protected mdHtml(s: string): string { return mdInline(s); }

  protected goToGraph(specId: string): void {
    this.router.navigate(['/graph'], { queryParams: { focus: 'spec:' + specId } });
  }

  protected async onEditClick(): Promise<void> {
    const spec = this.selectedSpec();
    if (!spec) return;
    this.saveError.set(null);
    this.editing.set(true);
    this.editingSource.set(null);
    try {
      const projectQs = this.projects.projectQuery();
      // SpecDetailResponse may include a 'source' field (v0.2+ extension); fall back to body.
      const detail = await this.api.get<SpecDetailResponse & { source?: string | null }>(
        `/api/spec/${encodeURIComponent(spec.id)}${projectQs}`,
      );
      this.editingSource.set(detail.source ?? spec.body);
    } catch (e) {
      this.saveError.set(`Couldn't load source: ${e instanceof Error ? e.message : String(e)}`);
      this.editing.set(false);
    }
  }

  protected onEditorValueChange(next: string): void {
    this.editingSource.set(next);
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
      await this.api.put<{ ok: boolean }>(
        `/api/spec/${encodeURIComponent(spec.id)}${projectQs}`,
        { content },
      );
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

  protected onDraftWithClaudeClick(): void { this.draftModalOpen.set(true); }
  protected onDraftModalClose(): void { this.draftModalOpen.set(false); }
}
