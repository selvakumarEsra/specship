import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from '../api/api';
import { RefreshService } from '../api/refresh';
import { NotificationsService, AlertType } from './notifications';

interface AlertEvent {
  kind: AlertType | 'activity';
  project: string;
  projectPath: string;
  id: string;
  title: string;
  detail?: string;
  status?: string;
}

/**
 * Subscribes to the cross-project `/api/events` SSE and:
 *
 *  1. Turns alert-worthy transitions (approval / run done / drift, across all
 *     projects) into desktop notifications (REQ-PWA-002) — gated by
 *     NotificationsService on permission + per-type toggles.
 *  2. Bumps the global refresh tick (debounced) on ANY event — including the
 *     `activity` index-freshness signal — so fetch-once pages (dashboard,
 *     drift queue, costs, …) track the live index/ingest without manual
 *     refresh (REQ-DASHUX-004). `apiResource` already reads the tick.
 *
 * The stream goes through ApiService.openEventStream so the API base (dev
 * server, `?api=` override) resolves exactly like every other request — a
 * bare `new EventSource('/api/events')` silently never connected under the
 * dev server. EventSource auto-reconnects after drops; when it can't connect
 * at all, pages simply keep their fetch-once behavior (REQ-DASHUX-004.A2).
 */
@Injectable({ providedIn: 'root' })
export class EventMonitorService {
  private closeStream: (() => void) | null = null;
  private refreshDebounce: ReturnType<typeof setTimeout> | null = null;
  private readonly api = inject(ApiService);
  private readonly refresh = inject(RefreshService);
  private readonly notify = inject(NotificationsService);
  private readonly router = inject(Router);

  start(): void {
    if (this.closeStream || typeof EventSource === 'undefined') return;
    this.closeStream = this.api.openEventStream(
      '/api/events',
      (type, data) => {
        if (type !== 'message') return;
        const ev = data as AlertEvent;
        if (!ev || typeof ev !== 'object' || !ev.kind) return;
        // Every event means server-side state moved — refetch what's on screen.
        this.scheduleRefresh();
        if (ev.kind === 'activity') return; // freshness signal only, no toast
        if (ev.kind !== 'approval' && ev.kind !== 'runDone' && ev.kind !== 'drift' && ev.kind !== 'reflect') return;
        this.notify.notify(ev.kind, ev.title, {
          body: ev.detail,
          tag: `${ev.project}:${ev.kind}:${ev.id}`,
          onClick: () => this.routeFor(ev),
        });
      },
      () => { /* EventSource reconnects on its own; nothing to do */ },
      [], // named event types: none — this stream uses bare `data:` messages
    );
  }

  stop(): void {
    this.closeStream?.();
    this.closeStream = null;
    if (this.refreshDebounce) {
      clearTimeout(this.refreshDebounce);
      this.refreshDebounce = null;
    }
  }

  /** Coalesce event bursts into one tick bump (trailing 1.5s debounce). */
  private scheduleRefresh(): void {
    if (this.refreshDebounce) return;
    this.refreshDebounce = setTimeout(() => {
      this.refreshDebounce = null;
      this.refresh.notifyLocalChange();
    }, 1500);
  }

  private routeFor(ev: AlertEvent): void {
    const queryParams = { project: ev.project };
    if (ev.kind === 'drift') {
      void this.router.navigate(['/drift'], { queryParams });
    } else if (ev.kind === 'reflect') {
      void this.router.navigate(['/improvements'], { queryParams });
    } else {
      void this.router.navigate(['/runs', ev.id], { queryParams });
    }
  }
}
