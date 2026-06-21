import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import { ApiService } from './api';
import { ProjectsService } from './projects';
import { ConnectionService } from './connection';

/**
 * Global refresh broadcast for the dashboard.
 *
 * `apiResource` reads `tick` so every project-scoped resource re-fetches
 * whenever `triggerGlobalRefresh()` resolves — Sessions, Heatmap, Costs,
 * Memory, Drift, Graph, Specs, etc. all update in lockstep. The
 * server-side `POST /api/refresh` step also forces a SpecShip index
 * sync AND a Claude Code transcript ingest pass, so the data the
 * refetches load is current — not just re-pulled from a stale DB.
 *
 * Why not per-page refresh buttons: users expect the status-strip
 * refresh icon to refresh "everything they can see right now." Wiring
 * each page individually would scale badly and miss the cross-cutting
 * dependencies (e.g. drift count in the strip needs to update too).
 */
@Injectable({ providedIn: 'root' })
export class RefreshService {
  private readonly api = inject(ApiService);
  private readonly projects = inject(ProjectsService);
  private readonly connection = inject(ConnectionService);

  private readonly tickSig = signal(0);
  private readonly loadingSig = signal(false);
  private readonly errorSig = signal<string | null>(null);
  private readonly lastRefreshSig = signal<number | null>(null);

  /** Bump on each successful refresh; apiResource subscribes. */
  readonly tick: Signal<number> = this.tickSig.asReadonly();
  /** True while the server-side sync + ingest is in flight. */
  readonly loading: Signal<boolean> = this.loadingSig.asReadonly();
  /** Last error message; cleared by the next successful refresh. */
  readonly error: Signal<string | null> = this.errorSig.asReadonly();
  /** Epoch ms of the last successful refresh response. */
  readonly lastRefreshAt: Signal<number | null> = this.lastRefreshSig.asReadonly();

  /** "10s ago" style label for the status strip. */
  readonly lastRefreshLabel = computed<string | null>(() => {
    const ts = this.lastRefreshSig();
    if (ts === null) return null;
    const diff = Date.now() - ts;
    if (diff < 5_000) return 'just now';
    if (diff < 60_000) return `${Math.round(diff / 1_000)}s ago`;
    if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
    return `${Math.round(diff / 3_600_000)}h ago`;
  });

  /**
   * Trigger a server-side sync + ingest, then bump the tick so every
   * apiResource on the current page refetches. Resolves when the
   * round-trip completes (or fails).
   *
   * Safe to call concurrently — overlapping calls are coalesced via
   * the loading flag. The button caller disables itself while loading.
   */
  async triggerGlobalRefresh(): Promise<void> {
    if (this.loadingSig()) return;
    // Server-dependent action — no-op while offline with a clear notice
    // instead of firing a request that will reject (REQ-OFFLINE-004).
    if (!this.connection.online()) {
      this.errorSig.set('Offline — reconnect to refresh');
      return;
    }
    this.loadingSig.set(true);
    this.errorSig.set(null);
    try {
      const projectQs = this.projects.projectQuery();
      const res = await this.api.post<{ ok: boolean; syncError: string | null; ingestError: string | null }>(
        `/api/refresh${projectQs}`,
        {},
      );
      // A partial failure (sync OK, ingest failed — or vice versa)
      // still bumps the tick so the surfaces that DID update reflect
      // the change. We surface the partial error separately for the
      // UI to show as a toast or banner.
      if (res.syncError || res.ingestError) {
        this.errorSig.set([res.syncError, res.ingestError].filter(Boolean).join(' · '));
      }
      this.lastRefreshSig.set(Date.now());
      this.tickSig.update((n) => n + 1);
    } catch (e) {
      this.errorSig.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.loadingSig.set(false);
    }
  }

  /**
   * Bump the tick WITHOUT calling the server — for callers that
   * already mutated server state via their own endpoint and just want
   * the cross-page refetch. (Example: the spec editor's PUT handler
   * calls this after saving so every spec-listing surface refetches.)
   */
  notifyLocalChange(): void {
    this.lastRefreshSig.set(Date.now());
    this.tickSig.update((n) => n + 1);
  }
}
