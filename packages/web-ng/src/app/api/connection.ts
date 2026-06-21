import { Injectable, Signal, computed, signal } from '@angular/core';

/**
 * Connection state — the single source of truth for "is the SpecShip server
 * reachable right now". Drives the ● Live / ● Offline indicator (REQ-OFFLINE-002),
 * the staleness label on cached data (REQ-OFFLINE-003), and the disabled state of
 * server-dependent actions (REQ-OFFLINE-004).
 *
 * We deliberately do NOT trust `navigator.onLine === true` as proof of
 * reachability — the browser can be "online" while the local `specship serve`
 * process is down. Reachability is therefore derived from the real outcome of
 * API requests: `apiResource` calls `noteSuccess()` on any completed fetch and
 * `noteOffline()` when a fetch fails at the network layer (server unreachable /
 * no API configured), as opposed to an HTTP error (server reachable, responded
 * non-2xx). `navigator`'s `offline` event is used only as an early negative
 * signal; coming back `online` is confirmed by the next successful fetch.
 */
const LS_LAST_ONLINE = 'specship.lastOnline';

@Injectable({ providedIn: 'root' })
export class ConnectionService {
  private readonly onlineSig = signal(true);
  /** Epoch ms of the last successful API response — the "data is from X ago" anchor. */
  private readonly lastOnlineAtSig = signal<number | null>(null);

  /** True while the server is reachable. */
  readonly online: Signal<boolean> = this.onlineSig.asReadonly();
  readonly lastOnlineAt: Signal<number | null> = this.lastOnlineAtSig.asReadonly();

  /** Relative-age label for the last successful fetch, e.g. "4m ago". Null until first success. */
  readonly lastOnlineLabel: Signal<string | null> = computed(() => {
    const ts = this.lastOnlineAtSig();
    if (ts === null) return null;
    const diff = Date.now() - ts;
    if (diff < 10_000) return 'just now';
    if (diff < 60_000) return `${Math.round(diff / 1_000)}s ago`;
    if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
    return `${Math.round(diff / 86_400_000)}d ago`;
  });

  constructor() {
    // Seed the last-online time from a previous session so a cold reload while
    // the server is down can still show "data from X ago" (REQ-OFFLINE-003.A3),
    // not just a bare "Offline".
    if (typeof localStorage !== 'undefined') {
      try {
        const raw = localStorage.getItem(LS_LAST_ONLINE);
        const n = raw ? Number(raw) : NaN;
        if (Number.isFinite(n)) this.lastOnlineAtSig.set(n);
      } catch { /* unavailable — ignore */ }
    }
    if (typeof window !== 'undefined') {
      // Browser-level "offline" is a fast, trustworthy negative signal.
      window.addEventListener('offline', () => this.onlineSig.set(false));
      // Coming back "online" at the browser layer does NOT mean the server is
      // up — leave it to the next successful fetch (noteSuccess) to flip us back.
    }
  }

  /** A real API request completed — the server is reachable. */
  noteSuccess(): void {
    const now = Date.now();
    this.lastOnlineAtSig.set(now);
    if (typeof localStorage !== 'undefined') {
      try { localStorage.setItem(LS_LAST_ONLINE, String(now)); } catch { /* ignore */ }
    }
    if (!this.onlineSig()) this.onlineSig.set(true);
  }

  /** A request failed at the network layer (unreachable / no API base). */
  noteOffline(): void {
    if (this.onlineSig()) this.onlineSig.set(false);
  }
}
