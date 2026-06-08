/**
 * ThemeService — single source of truth for dark/light mode.
 *
 * Honors the user's `prefers-color-scheme` when in 'system' mode, persists
 * the choice in localStorage, and writes `data-theme` on the document so
 * the design token CSS (see app/styles/_tokens.scss) flips at the root.
 */
import { Injectable, signal, effect, inject, DestroyRef } from '@angular/core';

export type ThemePref = 'dark' | 'light' | 'system';
type Effective = 'dark' | 'light';

const LS_KEY = 'specship.theme';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly destroyRef = inject(DestroyRef);
  readonly pref = signal<ThemePref>(this.loadPref());
  readonly effective = signal<Effective>('dark');

  constructor() {
    this.applyEffective();

    // React to system theme changes when the user is on 'system' mode.
    const mql = window.matchMedia('(prefers-color-scheme: light)');
    const listener = () => { if (this.pref() === 'system') this.applyEffective(); };
    mql.addEventListener('change', listener);
    this.destroyRef.onDestroy(() => mql.removeEventListener('change', listener));

    // Persist pref changes + reapply.
    effect(() => {
      const p = this.pref();
      try { localStorage.setItem(LS_KEY, p); } catch { /* noop */ }
      this.applyEffective();
    });
  }

  setPref(p: ThemePref): void {
    this.pref.set(p);
  }

  toggle(): void {
    this.setPref(this.effective() === 'dark' ? 'light' : 'dark');
  }

  private loadPref(): ThemePref {
    try {
      const v = localStorage.getItem(LS_KEY);
      if (v === 'dark' || v === 'light' || v === 'system') return v;
    } catch { /* noop */ }
    return 'dark';
  }

  private applyEffective(): void {
    const sys: Effective = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    const p = this.pref();
    const eff: Effective = p === 'system' ? sys : p;
    document.documentElement.setAttribute('data-theme', eff);
    this.effective.set(eff);
  }
}
