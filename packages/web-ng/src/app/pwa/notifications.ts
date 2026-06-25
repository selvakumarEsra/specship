import { Injectable, computed, signal } from '@angular/core';

/** The alert classes a user can toggle independently (REQ-PWA-003). */
export type AlertType = 'approval' | 'runDone' | 'drift';

type PermState = 'granted' | 'denied' | 'default' | 'unsupported';

const LS_PREFS = 'specship.notify.prefs';
const DEFAULT_PREFS: Record<AlertType, boolean> = { approval: true, runDone: true, drift: true };

/**
 * Desktop-notification permission + per-type preferences (REQ-PWA-003), plus a
 * guarded `notify()` that the live-event wiring (REQ-PWA-002) calls. Permission
 * is requested only via `requestPermission()` (an explicit user action) — never
 * on load. When permission is denied or the Notifications API is unsupported,
 * everything no-ops silently and `permission()` reflects the state for the UI.
 */
@Injectable({ providedIn: 'root' })
export class NotificationsService {
  readonly permission = signal<PermState>('default');
  private readonly prefs = signal<Record<AlertType, boolean>>(this.loadPrefs());

  readonly supported = computed(() => this.permission() !== 'unsupported');
  readonly granted = computed(() => this.permission() === 'granted');

  constructor() {
    if (typeof window === 'undefined' || typeof Notification === 'undefined') {
      this.permission.set('unsupported');
      return;
    }
    this.permission.set(Notification.permission as PermState);
  }

  enabled(type: AlertType): boolean {
    return this.prefs()[type] !== false;
  }

  toggle(type: AlertType): void {
    const next = { ...this.prefs(), [type]: !this.enabled(type) };
    this.prefs.set(next);
    this.savePrefs(next);
  }

  /** Request OS permission. Call ONLY from an explicit user action. */
  async requestPermission(): Promise<void> {
    if (typeof Notification === 'undefined') {
      this.permission.set('unsupported');
      return;
    }
    try {
      const res = await Notification.requestPermission();
      this.permission.set(res as PermState);
    } catch {
      /* noop */
    }
  }

  /**
   * Fire a desktop notification when permission is granted AND this alert type
   * is enabled; otherwise no-op. `tag` collapses repeats of the same underlying
   * event (dedupe). Activating it focuses the app and runs `onClick`.
   */
  notify(
    type: AlertType,
    title: string,
    opts: { body?: string; tag?: string; onClick?: () => void } = {},
  ): void {
    if (this.permission() !== 'granted' || !this.enabled(type)) return;
    if (typeof Notification === 'undefined') return;
    try {
      const n = new Notification(title, { body: opts.body, tag: opts.tag });
      if (opts.onClick) {
        n.onclick = () => {
          try { window.focus(); } catch { /* noop */ }
          opts.onClick!();
          n.close();
        };
      }
    } catch {
      /* noop */
    }
  }

  private loadPrefs(): Record<AlertType, boolean> {
    if (typeof localStorage === 'undefined') return { ...DEFAULT_PREFS };
    try {
      const raw = localStorage.getItem(LS_PREFS);
      return raw ? { ...DEFAULT_PREFS, ...JSON.parse(raw) } : { ...DEFAULT_PREFS };
    } catch {
      return { ...DEFAULT_PREFS };
    }
  }

  private savePrefs(p: Record<AlertType, boolean>): void {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.setItem(LS_PREFS, JSON.stringify(p)); } catch { /* noop */ }
  }
}
