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
 */
import { Signal, signal, effect, DestroyRef, inject } from '@angular/core';
import { ApiError, ApiService } from './api';
import { RefreshService } from './refresh';

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
}

export interface ApiResource<T> {
  readonly state: Signal<ApiResourceState<T>>;
  refetch(): void;
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
  const state = signal<ApiResourceState<T>>({ data: null, loading: true, error: null, source: 'init', noProject: false });
  const destroyRef = inject(DestroyRef);
  // Subscribe to the global refresh broadcast. Reading `tick` inside
  // the effect below causes every resource to refetch when the status
  // strip's refresh button fires — without per-page wiring. Resources
  // that don't want to participate (e.g. one-shot static lookups) can
  // be added as an opt-out later; today every resource opts in by
  // virtue of going through this helper.
  const refresh = inject(RefreshService);

  const trigger = signal(0);
  const fetchOnce = () => {
    const path = pathFn();
    if (!path) {
      state.set({ data: null, loading: false, error: null, source: 'init', noProject: false });
      return;
    }
    if (currentController) currentController.abort();
    currentController = new AbortController();
    state.update((s) => ({ ...s, loading: true, error: null, noProject: false }));
    api
      .get<T>(path, currentController.signal)
      .then((data) => state.set({ data, loading: false, error: null, source: 'api', noProject: false }))
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        const noProject = err instanceof ApiError && err.status === 409 && (err.code === 'no_project' || err.code === 'no_primary');
        state.set({
          data: null,
          loading: false,
          error: noProject ? null : (err instanceof Error ? err : new Error(String(err))),
          source: 'api',
          noProject,
        });
      });
  };

  let currentController: AbortController | null = null;

  effect(() => {
    // Re-run whenever pathFn's tracked signals change, refetch bumps
    // the local trigger, OR the global refresh service ticks. The
    // global tick is what makes the status strip's refresh button
    // pull Sessions / Heatmap / Costs / Memory / Drift current
    // without per-page wiring.
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
