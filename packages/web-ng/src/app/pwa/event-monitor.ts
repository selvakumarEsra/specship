import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { NotificationsService, AlertType } from './notifications';

interface AlertEvent {
  kind: AlertType;
  project: string;
  projectPath: string;
  id: string;
  title: string;
  detail?: string;
  status?: string;
}

/**
 * Subscribes to the cross-project `/api/events` SSE and turns alert-worthy
 * transitions (approval / run done / drift, across all projects) into desktop
 * notifications (REQ-PWA-002). Firing is gated by NotificationsService on
 * permission + per-type toggles; the server only emits NEW transitions and the
 * notification `tag` collapses repeats, so a single transition pops once.
 * EventSource auto-reconnects, so notifications resume after the server returns.
 */
@Injectable({ providedIn: 'root' })
export class EventMonitorService {
  private es: EventSource | null = null;
  private readonly notify = inject(NotificationsService);
  private readonly router = inject(Router);

  start(): void {
    if (this.es || typeof EventSource === 'undefined') return;
    try {
      this.es = new EventSource('/api/events');
    } catch {
      return;
    }
    this.es.onmessage = (e: MessageEvent) => {
      let ev: AlertEvent;
      try {
        ev = JSON.parse(e.data) as AlertEvent;
      } catch {
        return;
      }
      if (!ev || (ev.kind !== 'approval' && ev.kind !== 'runDone' && ev.kind !== 'drift' && ev.kind !== 'reflect')) return;
      this.notify.notify(ev.kind, ev.title, {
        body: ev.detail,
        tag: `${ev.project}:${ev.kind}:${ev.id}`,
        onClick: () => this.routeFor(ev),
      });
    };
    // onerror: EventSource reconnects on its own; nothing to do.
  }

  stop(): void {
    this.es?.close();
    this.es = null;
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
