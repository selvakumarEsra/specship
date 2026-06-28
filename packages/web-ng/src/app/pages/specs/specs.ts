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
import { ConnectionService } from '../../api/connection';
import { PickProjectEmpty } from '../../shell/pick-project-empty/pick-project-empty';
import { Icon } from '../../shell/icon/icon';
import { SpecEditor } from '../../components/spec-editor/spec-editor';
import { DraftWithClaudeModal } from '../../components/draft-with-claude-modal/draft-with-claude-modal';
import { Empty } from '../../ui/empty';
import { StatePill } from '../../ui/state-pill';
import { Pill } from '../../ui/pill';
import { CopyBtn } from '../../ui/copy-btn';
import { STATE } from '../../ui/state';
import type { Spec, SpecsResponse, SpecDetailResponse, SpecLink, SpecBriefResponse, SpecFunnel } from '../../api/types';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { renderMd } from '../../util/render-md';

interface Group { path: string; title: string; specs: Spec[]; }

/** Strip embedded `<!-- id: REQ-X -->` markers — structural noise, not prose. */
function stripSpecMarkers(s: string): string {
  return s.replace(/<!--[\s\S]*?-->/g, '');
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
  protected readonly conn = inject(ConnectionService);
  private readonly sanitizer = inject(DomSanitizer);

  protected readonly resource = apiResource<SpecsResponse>(
    this.api,
    () => `/api/specs${this.projects.projectQuery()}`,
  );

  // @implements REQ-FUNNEL-006
  /** Spec lifecycle funnel (idea → spec → implemented). Cached/offline via apiResource. */
  protected readonly funnelResource = apiResource<SpecFunnel>(
    this.api,
    () => `/api/spec/funnel${this.projects.projectQuery()}`,
  );

  protected readonly funnel = computed<SpecFunnel | null>(() => this.funnelResource.state().data ?? null);

  /** Idea-state briefs (brainstormed, not yet linked to a spec). */
  protected readonly ideas = computed(() => this.funnel()?.ideas ?? []);

  /** Fetches links + siblings for the selected spec. */
  protected readonly detailResource = apiResource<SpecDetailResponse>(
    this.api,
    () => {
      const id = this.sel();
      if (!id) return null;
      return `/api/spec/${encodeURIComponent(id)}${this.projects.projectQuery()}`;
    },
  );

  /** Fetches the brainstorm brief for the selected spec (404 → no data → panel hidden). */
  protected readonly briefResource = apiResource<SpecBriefResponse>(
    this.api,
    () => {
      const id = this.sel();
      if (!id) return null;
      return `/api/spec/${encodeURIComponent(id)}/brief${this.projects.projectQuery()}`;
    },
  );

  protected readonly briefHtml = computed<SafeHtml>(() =>
    this.renderBody(this.briefResource.state().data?.markdown ?? ''),
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
    // Briefs are surfaced separately in the Ideas section, not as doc groups.
    const all = (this.resource.state().data?.specs ?? []).filter((s) => s.kind !== 'brief');
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
    // Search all specs (including briefs, which are filtered out of the doc
    // groups but selectable from the Ideas section) so a selected brief renders.
    const all = this.resource.state().data?.specs ?? [];
    return all.find((s) => s.id === id) ?? null;
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

  /** Render spec/brief markdown to sanitized HTML (headings, lists, code, tables). */
  protected renderBody(md: string): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(renderMd(stripSpecMarkers(md)));
  }

  protected goToGraph(specId: string): void {
    this.router.navigate(['/graph'], { queryParams: { focus: 'spec:' + specId } });
  }

  /** Open a spec's dedicated detail route (DASH-SPECDETAIL-DOC, REQ-006.A1). */
  protected open(specId: string): void {
    this.router.navigate(['/specs', specId]);
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
    // Server-dependent action — block with a notice while offline rather than
    // firing a PUT that will reject and lose the edit (REQ-OFFLINE-004).
    if (!this.conn.online()) {
      this.saveError.set('Offline — reconnect to save your changes');
      return;
    }
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
