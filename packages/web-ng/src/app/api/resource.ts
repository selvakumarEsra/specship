/**
 * Signal-based data resource — Angular's idiomatic equivalent of the
 * React `useApi(path)` hook from the React port.
 *
 * Usage in a component:
 *   private readonly api = inject(ApiService);
 *   protected readonly status = apiResource(this.api, '/api/status');
 *
 *   // In the template:
 *   @if (status().loading) { ... }
 *   @else if (status().data) { {{ status().data.backend }} }
 *
 * The fetched data lives in a signal; loading and error are siblings.
 * Re-fetch by calling `refetch()` on the returned object. The hook
 * subscribes to a `version` source signal (optional) so the fetch
 * re-runs whenever it changes — useful for range selectors, etc.
 *
 * Offline behaviour (REQ-OFFLINE-003): every successful response is cached to
 * localStorage keyed by its path. When a fetch fails at the NETWORK layer
 * (server unreachable / no API base) — as opposed to an HTTP error, where the
 * server is reachable but responded non-2xx — the last cached value is served
 * instead of wiping to an error, flagged `stale: true` with its `cachedAt`
 * timestamp. The connection state is reported to `ConnectionService` so the
 * ● Live / ● Offline indicator and the staleness label stay in sync.
 */
import { Signal, signal, effect, DestroyRef, inject } from '@angular/core';
import { ApiError, ApiService } from './api';
import { RefreshService } from './refresh';
import { ConnectionService } from './connection';

export interface ApiResourceState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  /** 'api' once a real fetch completes; 'init' before first fetch. */
  source: 'api' | 'init';
  /**
   * True when the backend responded 409 with `code: "no_project"` or
   * `code: "no_primary"` — i.e. the route is project-scoped and nothing's
   * been picked. Pages render a "pick a project" empty state in this case
   * instead of an error banner.
   */
  noProject: boolean;
  /** True when `data` is being served from the offline cache, not a live fetch. */
  stale: boolean;
  /** Epoch ms the served `data` was originally fetched (cache timestamp), or null. */
  cachedAt: number | null;
}

export interface ApiResource<T> {
  readonly state: Signal<ApiResourceState<T>>;
  refetch(): void;
}

const CACHE_PREFIX = 'specship.cache:';

interface CacheEntry<T> { data: T; ts: number; }

function readCache<T>(path: string): CacheEntry<T> | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + path);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry<T>;
    if (parsed && typeof parsed.ts === 'number' && 'data' in parsed) return parsed;
  } catch { /* corrupt / unavailable — ignore */ }
  return null;
}

function writeCache<T>(path: string, data: T): number {
  const ts = Date.now();
  if (typeof localStorage === 'undefined') return ts;
  try {
    localStorage.setItem(CACHE_PREFIX + path, JSON.stringify({ data, ts }));
  } catch { /* quota exceeded / unavailable — best-effort, skip */ }
  return ts;
}

/**
 * Create a fetched-data signal. The `pathFn` is a function so callers can
 * derive the URL from other signals (range, project filter, etc.) and the
 * effect re-runs on changes.
 */
export function apiResource<T>(
  api: ApiService,
  pathFn: () => string | null
): ApiResource<T> {
  const state = signal<ApiResourceState<T>>({ data: null, loading: true, error: null, source: 'init', noProject: false, stale: false, cachedAt: null });
  const destroyRef = inject(DestroyRef);
  // Subscribe to the global refresh broadcast. Reading `tick` inside
  // the effect below causes every resource to refetch when the status
  // strip's refresh button fires — without per-page wiring.
  const refresh = inject(RefreshService);
  const connection = inject(ConnectionService);

  const trigger = signal(0);
  const fetchOnce = () => {
    const path = pathFn();
    if (!path) {
      state.set({ data: null, loading: false, error: null, source: 'init', noProject: false, stale: false, cachedAt: null });
      return;
    }
    if (currentController) currentController.abort();
    currentController = new AbortController();
    state.update((s) => ({ ...s, loading: true, error: null, noProject: false }));
    api
      .get<T>(path, currentController.signal)
      .then((data) => {
        const ts = writeCache(path, data);
        connection.noteSuccess();
        state.set({ data, loading: false, error: null, source: 'api', noProject: false, stale: false, cachedAt: ts });
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return;

        // HTTP error → the server IS reachable, it just responded non-2xx.
        if (err instanceof ApiError) {
          connection.noteSuccess();
          const noProject = err.status === 409 && (err.code === 'no_project' || err.code === 'no_primary');
          state.set({
            data: null,
            loading: false,
            error: noProject ? null : err,
            source: 'api',
            noProject,
            stale: false,
            cachedAt: null,
          });
          return;
        }

        // Network-layer failure (server unreachable / no API base) → offline.
        // Serve the last cached value rather than wiping to an error.
        connection.noteOffline();
        const cached = readCache<T>(path);
        if (cached) {
          state.set({ data: cached.data, loading: false, error: null, source: 'api', noProject: false, stale: true, cachedAt: cached.ts });
        } else {
          state.set({
            data: null,
            loading: false,
            error: err instanceof Error ? err : new Error(String(err)),
            source: 'api',
            noProject: false,
            stale: true,
            cachedAt: null,
          });
        }
      });
  };

  let currentController: AbortController | null = null;

  effect(() => {
    // Re-run whenever pathFn's tracked signals change, refetch bumps
    // the local trigger, OR the global refresh service ticks.
    pathFn();
    trigger();
    refresh.tick();
    fetchOnce();
  });

  destroyRef.onDestroy(() => {
    currentController?.abort();
  });

  return {
    state,
    refetch: () => trigger.update((n) => n + 1),
  };
}
