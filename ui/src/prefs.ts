/**
 * Local appearance/editor preferences (REQ-DESKTOP-028.A1) — same
 * localStorage + window-event pattern as theme.ts. These are client-side
 * prefs (per browser/app install); server-side config goes through
 * /api/config instead.
 */

export type DensityPref = 'comfortable' | 'compact';

const DENSITY_KEY = 'specship-density';
const BOOT_ANIM_KEY = 'specship-boot-anim';
const EDITOR_KEY = 'specship-editor';

/** Session marker the boot splash sets after playing once (design bundle). */
export const BOOTED_SESSION_KEY = 'specship-booted';

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

export function getBootAnim(): boolean {
  try {
    return localStorage.getItem(BOOT_ANIM_KEY) !== '0';
  } catch { /* storage unavailable */ }
  return true;
}

export function setBootAnim(on: boolean): void {
  try { localStorage.setItem(BOOT_ANIM_KEY, on ? '1' : '0'); } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event('specship-prefs'));
}

/** Editors the Settings "Open files with" select offers (design bundle). */
export const EDITORS = [
  { value: 'code', label: 'code (VS Code)' },
  { value: 'subl', label: 'subl (Sublime)' },
  { value: 'cursor', label: 'cursor' },
  { value: 'nvim', label: 'nvim' },
] as const;

export type EditorPref = (typeof EDITORS)[number]['value'];

export function getEditor(): EditorPref {
  try {
    const v = localStorage.getItem(EDITOR_KEY);
    if (EDITORS.some((e) => e.value === v)) return v as EditorPref;
  } catch { /* storage unavailable */ }
  return 'code';
}

export function setEditor(v: EditorPref): void {
  try { localStorage.setItem(EDITOR_KEY, v); } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event('specship-prefs'));
}
