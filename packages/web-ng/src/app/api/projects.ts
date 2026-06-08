/**
 * ProjectsService — discovers every project visible to Claude Code
 * (~/.claude/projects/) via /api/projects, and keeps the list live via
 * /api/projects/events (SSE).
 *
 * State exposed as signals:
 *   - `projects()`     — current snapshot, sorted by recency
 *   - `loading()`      — true until the first /api/projects resolves
 *   - `error()`        — last load error, if any
 *   - `activeSlug()`   — the user's currently-picked project slug, persisted
 *                        in localStorage. `null` means "no project selected".
 *   - `active()`       — convenience: the ProjectEntry for activeSlug(), or null
 *
 * The picker UI subscribes to `projects()`; other surfaces can subscribe to
 * `activeSlug()` later to scope analytics queries (Phase 2 work).
 */
import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { ApiService } from './api';
import type { ProjectEntry, ProjectsChange, ProjectsRefresh, ProjectsResponse } from './types';

const LS_ACTIVE = 'specship.activeProjectSlug';

@Injectable({ providedIn: 'root' })
export class ProjectsService {
  private readonly api = inject(ApiService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly _projects = signal<ProjectEntry[]>([]);
  private readonly _claudeRoot = signal<string | null>(null);
  private readonly _loading = signal<boolean>(true);
  private readonly _error = signal<string | null>(null);
  private readonly _activeSlug = signal<string | null>(readActiveSlug());

  /** Public read-only view of the discovered projects. */
  readonly projects = this._projects.asReadonly();
  readonly claudeRoot = this._claudeRoot.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly activeSlug = this._activeSlug.asReadonly();
  readonly active = computed<ProjectEntry | null>(() => {
    const slug = this._activeSlug();
    if (!slug) return null;
    return this._projects().find((p) => p.slug === slug) ?? null;
  });

  private closeStream: (() => void) | null = null;

  constructor() {
    void this.refresh();
    this.subscribe();
    this.destroyRef.onDestroy(() => this.closeStream?.());
  }

  /** One-shot reload — used by an explicit refresh button or after errors. */
  async refresh(): Promise<void> {
    this._loading.set(true);
    this._error.set(null);
    try {
      const resp = await this.api.get<ProjectsResponse>('/api/projects');
      this._claudeRoot.set(resp.claudeRoot);
      this._projects.set(resp.projects);
      this.reconcileActive(resp.projects);
    } catch (err) {
      this._error.set(err instanceof Error ? err.message : String(err));
    } finally {
      this._loading.set(false);
    }
  }

  /**
   * Compose the `?project=<slug>` (or `&project=<slug>`) query suffix from
   * the active slug. Pages use this inside their `apiResource` path-fn so
   * the URL — and therefore the fetch — re-evaluates when the user picks a
   * different project.
   *
   * Returns an empty string when no project is active; the corresponding
   * route then either falls back to the boot-time primary (specship-scoped
   * routes) or returns its global view (memory).
   */
  projectQuery(separator: '?' | '&' = '?'): string {
    const slug = this._activeSlug();
    return slug ? `${separator}project=${encodeURIComponent(slug)}` : '';
  }

  /** Set / clear the active project. Persists across reloads. */
  setActive(slug: string | null): void {
    this._activeSlug.set(slug);
    try {
      if (slug) localStorage.setItem(LS_ACTIVE, slug);
      else localStorage.removeItem(LS_ACTIVE);
    } catch { /* private mode / quota / SSR — non-fatal */ }
  }

  // --- Internals ----------------------------------------------------------

  private subscribe(): void {
    // The /api/projects/events stream emits three named events:
    //   snapshot — sent once on connect; replaces the list.
    //   change   — emitted when slugs are added/removed; replaces the list.
    //   refresh  — emitted on any rescan (also when only mtimes drifted);
    //              replaces the list. Cheap to apply.
    this.closeStream = this.api.openEventStream(
      '/api/projects/events',
      (type, data) => {
        if (type === 'snapshot') {
          const payload = data as ProjectsResponse;
          this._claudeRoot.set(payload.claudeRoot);
          this._projects.set(payload.projects ?? []);
          this.reconcileActive(payload.projects ?? []);
        } else if (type === 'change') {
          const payload = data as ProjectsChange;
          this._projects.set(payload.list);
          this.reconcileActive(payload.list);
        } else if (type === 'refresh') {
          const payload = data as ProjectsRefresh;
          this._projects.set(payload.list);
        }
      },
      (_err) => { /* EventSource auto-reconnects; we don't surface mid-stream errors */ },
      ['snapshot', 'change', 'refresh'],
    );
  }

  private reconcileActive(list: ProjectEntry[]): void {
    const slug = this._activeSlug();
    if (!slug) return;
    // If the previously-active project disappeared from disk entirely, drop
    // the selection so the UI prompts the user to pick a new one. We *don't*
    // drop on `exists: false` alone — the user may want to keep that pinned
    // to see archived analytics.
    if (!list.find((p) => p.slug === slug)) {
      this.setActive(null);
    }
  }
}

function readActiveSlug(): string | null {
  try { return localStorage.getItem(LS_ACTIVE); }
  catch { return null; }
}
