import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type ConfigResponse } from './api';
import { go } from './router';

export interface ApiState<T> {
  data: T | null;
  error: unknown;
  loading: boolean;
  reload: () => void;
}

/** Fetch-on-mount with reload; ignores results from superseded requests. */
export function useApi<T>(fn: () => Promise<T>, deps: unknown[] = []): ApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const gen = useRef(0);

  const run = useCallback(() => {
    const g = ++gen.current;
    setLoading(true);
    fn().then(
      (d) => { if (gen.current === g) { setData(d); setError(null); setLoading(false); } },
      (e) => { if (gen.current === g) { setError(e); setLoading(false); } },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => { run(); }, [run]);

  return { data, error, loading, reload: run };
}

/**
 * The server's runtime config (GET /api/config), refetched whenever anything
 * dispatches `specship-config` (the Settings ingest toggle does after a PUT)
 * so analytics screens react to the toggle in-session (REQ-DESKTOP-028.A2).
 */
export function useIngestConfig(): ApiState<ConfigResponse> {
  const state = useApi(() => api.config.get(), []);
  const { reload } = state;
  useEffect(() => {
    window.addEventListener('specship-config', reload);
    return () => window.removeEventListener('specship-config', reload);
  }, [reload]);
  return state;
}

/**
 * True when a keystroke belongs to a text-entry surface — chords and number
 * jumps must never fire there (REQ-DESKTOP-019.A3). The attribute check
 * backs up `isContentEditable` because jsdom never implements the latter.
 */
export function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  const ce = target.getAttribute('contenteditable');
  return ce === '' || ce === 'true';
}

/** How long a bare `g` stays armed waiting for the chord's second key. */
const CHORD_WINDOW_MS = 1000;

/** g-chord destinations: g g → Graph, g s → Specs, g d → Drift queue. */
const G_CHORDS: Record<string, string> = { g: 'graph', s: 'specs', d: 'drift' };

/**
 * App-wide keyboard shortcuts (REQ-DESKTOP-019):
 *   - ⌘/Ctrl K toggles the command palette (global — works in editables too,
 *     the modifier keeps it unambiguous).
 *   - ⌘/Ctrl 1–7 jumps to `pageIds[0..6]` (the first seven nav items).
 *   - Bare `g` arms a chord for ~1 s; then g/s/d navigates (G_CHORDS).
 * Number jumps and chords are suppressed while focus is in an editable field.
 */
// @implements REQ-DESKTOP-019
export function useGlobalShortcuts({ onTogglePalette, pageIds }: {
  onTogglePalette: () => void;
  pageIds: string[];
}): void {
  const armed = useRef(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    const disarm = () => {
      armed.current = false;
      if (timer.current !== null) { clearTimeout(timer.current); timer.current = null; }
    };
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        onTogglePalette();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && !e.altKey && /^[1-7]$/.test(e.key)) {
        if (isEditable(e.target)) return;
        const id = pageIds[parseInt(e.key, 10) - 1];
        if (id) { e.preventDefault(); go(id); }
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) { disarm(); return; }
      if (isEditable(e.target)) { disarm(); return; }
      if (armed.current) {
        disarm();
        const dest = G_CHORDS[e.key.toLowerCase()];
        if (dest) { e.preventDefault(); go(dest); }
        return;
      }
      if (e.key === 'g') {
        armed.current = true;
        timer.current = window.setTimeout(disarm, CHORD_WINDOW_MS);
      }
    };
    window.addEventListener('keydown', h);
    return () => { window.removeEventListener('keydown', h); disarm(); };
  }, [onTogglePalette, pageIds]);
}
