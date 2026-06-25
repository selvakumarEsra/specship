import { Injectable, signal } from '@angular/core';

/** The non-standardized install-prompt event (Chromium). */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * Tracks PWA installability and drives the in-app install affordance
 * (REQ-PWA-001). Captures the browser's deferred `beforeinstallprompt` so we can
 * show our own Install control, and hides it once installed or when already
 * running as a standalone app.
 */
@Injectable({ providedIn: 'root' })
export class PwaInstallService {
  private deferred: BeforeInstallPromptEvent | null = null;

  /** True only while the browser has offered installation and we're not installed. */
  readonly canInstall = signal(false);

  constructor() {
    if (typeof window === 'undefined') return;

    // Already launched as an installed standalone app → never offer install.
    const standalone =
      window.matchMedia?.('(display-mode: standalone)').matches === true ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    if (standalone) return;

    window.addEventListener('beforeinstallprompt', (e: Event) => {
      e.preventDefault(); // suppress the browser's default mini-infobar; we drive it
      this.deferred = e as BeforeInstallPromptEvent;
      this.canInstall.set(true);
    });

    window.addEventListener('appinstalled', () => {
      this.deferred = null;
      this.canInstall.set(false);
    });
  }

  /** Trigger the browser install flow. No-op if no prompt is available. */
  async install(): Promise<void> {
    const e = this.deferred;
    if (!e) return;
    this.deferred = null;
    this.canInstall.set(false); // hide immediately; browser re-fires if the user later wants it
    try {
      await e.prompt();
      await e.userChoice;
    } catch {
      /* user dismissed or unsupported — nothing to do */
    }
  }
}
