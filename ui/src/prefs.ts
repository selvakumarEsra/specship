/**
 * Local appearance preferences (REQ-DESKTOP-028.A1) — same localStorage +
 * window-event pattern as theme.ts. These are client-side prefs (per
 * browser/app install); server-side config goes through /api/config instead.
 *
 * Density, plus the Plan reader's depth (REQ-DASHSIMPLE-003.A6). The design
 * bundle's boot-animation and editor prefs were removed with their dead
 * Settings controls (REQ-SURF-004).
 */

/** How deep the Plan reader renders: epics, epics + stories, or everything. */
export type PlanLevel = 'epics' | 'stories' | 'all';

const PLAN_LEVEL_KEY = 'specship-plan-level';

// @implements REQ-DASHSIMPLE-003
export function getPlanLevel(): PlanLevel {
  try {
    const v = localStorage.getItem(PLAN_LEVEL_KEY);
    if (v === 'epics' || v === 'stories' || v === 'all') return v;
  } catch { /* storage unavailable */ }
  return 'all';
}

// @implements REQ-DASHSIMPLE-003
export function setPlanLevel(level: PlanLevel): void {
  try { localStorage.setItem(PLAN_LEVEL_KEY, level); } catch { /* storage unavailable */ }
}

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
