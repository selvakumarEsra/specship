/**
 * Local appearance preferences (REQ-DESKTOP-028.A1) — same localStorage +
 * window-event pattern as theme.ts. These are client-side prefs (per
 * browser/app install); server-side config goes through /api/config instead.
 *
 * Density is the only one: the design bundle's boot-animation and editor
 * prefs were removed with their dead Settings controls (REQ-SURF-004).
 */

export type DensityPref = 'comfortable' | 'compact';

const DENSITY_KEY = 'specship-density';

export function getDensity(): DensityPref {
  try {
    if (localStorage.getItem(DENSITY_KEY) === 'compact') return 'compact';
  } catch { /* storage unavailable */ }
  return 'comfortable';
}

/** Applies immediately (data-density drives the CSS overrides) and persists. */
export function applyDensity(pref: DensityPref): void {
  document.documentElement.setAttribute('data-density', pref);
  try { localStorage.setItem(DENSITY_KEY, pref); } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event('specship-density'));
}
