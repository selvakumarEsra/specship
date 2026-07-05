/** Theme handling ported from the design bundle's app.jsx (dark/light/system). */

export type ThemePref = 'dark' | 'light' | 'system';

const STORAGE_KEY = 'specship-theme';

export function getThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'dark' || v === 'light' || v === 'system') return v;
  } catch { /* storage unavailable */ }
  return 'dark';
}

export function effectiveTheme(pref: ThemePref): 'dark' | 'light' {
  if (pref === 'system') {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  return pref;
}

export function applyTheme(pref: ThemePref): void {
  document.documentElement.setAttribute('data-theme', effectiveTheme(pref));
  try { localStorage.setItem(STORAGE_KEY, pref); } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event('specship-theme'));
}

/** In system mode, follow OS preference changes live. */
export function watchSystemTheme(): void {
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (getThemePref() === 'system') applyTheme('system');
  });
}
