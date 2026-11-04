/**
 * Theme handling — the dashboard is dark-only (REQ-DASHTHEME-003). The
 * BookMyGame UI design system ships no light variant, so there is no theme
 * preference, no toggle and no OS (`prefers-color-scheme`) tracking.
 */

/** Storage key an earlier version used for the dark/light/system pref. */
const LEGACY_STORAGE_KEY = 'specship-theme';

/**
 * Pin the document to the dark theme. A stored `light` / `system` preference
 * from an earlier version is discarded silently (A2); the OS colour scheme is
 * never consulted (A3).
 */
export function applyTheme(): void {
  document.documentElement.setAttribute('data-theme', 'dark');
  try { localStorage.removeItem(LEGACY_STORAGE_KEY); } catch { /* storage unavailable */ }
}
