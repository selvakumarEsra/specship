/**
 * Root shell — sidebar + status strip + top bar + router outlet + command
 * palette. The shell is permanent; pages stream in via the router.
 */
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { RouterOutlet, Router } from '@angular/router';
import { Sidebar } from './shell/sidebar/sidebar';
import { StatusStrip } from './shell/status-strip/status-strip';
import { TopBar } from './shell/top-bar/top-bar';
import { CommandPalette } from './shell/command-palette/command-palette';
import { ThemeService } from './theme/theme';
import { EventMonitorService } from './pwa/event-monitor';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, Sidebar, StatusStrip, TopBar, CommandPalette],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(window:keydown)': 'onGlobalKey($event)',
  },
})
export class App {
  // Inject the theme service so its constructor runs (applies persisted choice on document).
  private readonly _theme = inject(ThemeService);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _router = inject(Router);
  private readonly _events = inject(EventMonitorService);

  constructor() {
    // Start the cross-project alert stream → desktop notifications (gated on
    // permission + per-type toggles inside NotificationsService).
    this._events.start();
  }

  protected readonly sidebarCollapsed = signal(
    typeof window !== 'undefined' && window.innerWidth < 1100
  );
  protected readonly paletteOpen = signal(false);

  // Cmd/Ctrl+K toggles palette; Escape closes; G then D/S chord nav.
  // (Inline HostListener decorator avoided per Angular best practices — host
  // map below handles the event binding.)
  private readonly gChord = { armed: false, t: 0 };

  protected onGlobalKey(ev: KeyboardEvent): void {
    const mod = ev.metaKey || ev.ctrlKey;
    if (mod && ev.key.toLowerCase() === 'k') {
      ev.preventDefault();
      this.paletteOpen.update((v) => !v);
      return;
    }
    if (ev.key === 'Escape') { this.paletteOpen.set(false); return; }
    if (!mod && ev.key.toLowerCase() === 'g' && !this.gChord.armed) {
      const t = ev.target as HTMLElement | null;
      if (t && /input|textarea/i.test(t.tagName)) return;
      this.gChord.armed = true;
      this.gChord.t = Date.now();
      setTimeout(() => { this.gChord.armed = false; }, 600);
      return;
    }
    if (this.gChord.armed && !mod) {
      const k = ev.key.toLowerCase();
      if (k === 'd') this._router.navigate(['/dashboard']);
      else if (k === 'g') this._router.navigate(['/graph']);
      else if (k === 's') this._router.navigate(['/specs']);
      this.gChord.armed = false;
    }
  }

  protected toggleSidebar(): void {
    this.sidebarCollapsed.update((v) => !v);
  }

  protected onOpenPalette(): void {
    this.paletteOpen.set(true);
  }

  protected onClosePalette(): void {
    this.paletteOpen.set(false);
  }
}

// Bind the global keydown listener via the @Component decorator's `host` map.
// (Adding via a directive `host:` ensures Angular cleans it up on destroy
// and doesn't leak across tests.)

