/**
 * Render the SpecShip status-line segment (REQ-STATUSLINE-001/005).
 *
 * Pure + deterministic: given the three caches it returns one line. No I/O,
 * no clock — the caller supplies everything. Output is the project's art-deco
 * style (gold ANSI, `◈`/`◆` separators) and strips all ANSI under `NO_COLOR`.
 *
 * Honesty rule (REQ-STATUSLINE-005.A5): this function NEVER emits a
 * tokens/cost "saved" figure. The call count is the only usage signal, framed
 * as "N calls" — what specship was asked, not a fabricated counterfactual.
 */

import { StatuslineCache, SessionMarker, ActiveRun, UsageLimits } from './types';

export interface RenderInput {
  cache: StatuslineCache | null;
  marker: SessionMarker | null;
  run: ActiveRun | null;
  /**
   * Real Claude Code usage limits from the external usage file (REQ-STATUSLINE-008),
   * or null/undefined to omit the usage sub-segment entirely. SpecShip never
   * estimates these — null in, nothing rendered.
   */
  usage?: UsageLimits | null;
  /**
   * Current time (ms epoch) used ONLY to format `usage` reset times in local
   * time; keeps this function pure (no clock). Required when `usage` is present.
   */
  now?: number;
  /** When true, emit no ANSI escapes. */
  noColor: boolean;
}

/** A 5-cell art-deco bar (`❮▰▱❯`) depicting `pct` (0-100) capacity used. */
function bar(pct: number): string {
  const cells = 5;
  const filled = Math.max(0, Math.min(cells, Math.round((pct / 100) * cells)));
  return `❮${'▰'.repeat(filled)}${'▱'.repeat(cells - filled)}❯`;
}

/**
 * Format a reset instant in the machine's local timezone: time-only when it
 * falls on the same local day as `now` (e.g. `(4pm)`), date + time otherwise
 * (e.g. `(6/29, 2pm)`). Minutes shown only when non-zero.
 */
function formatReset(resetMs: number, nowMs: number): string {
  const r = new Date(resetMs);
  const n = new Date(nowMs);
  const h = r.getHours();
  const m = r.getMinutes();
  const ampm = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 || 12;
  const time = m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2, '0')}${ampm}`;
  const sameDay =
    r.getFullYear() === n.getFullYear() && r.getMonth() === n.getMonth() && r.getDate() === n.getDate();
  return sameDay ? `(${time})` : `(${r.getMonth() + 1}/${r.getDate()}, ${time})`;
}

const ESC = '\u001b';

// ANSI 256-color palette — the gold deco family, matching the bars.
const COLOR = {
  orn: 178,    // antique gold — ornaments / brand
  frame: 137,  // muted bronze — separators
  synced: 71,  // green
  pending: 214,// amber
  drift: 203,  // red
  wasm: 220,   // bright gold/yellow — slow-path warning
  calls: 178,  // gold
  run: 75,     // blue — spec/run
  dim: 240,    // grey — degraded/idle
} as const;

function paint(noColor: boolean, code: number, s: string): string {
  if (noColor) return s;
  return `${ESC}[38;5;${code}m${s}${ESC}[0m`;
}

/**
 * Build the segment line. Always returns a single non-empty line; degrades to
 * a minimal `◈ specship … ◈` when caches are absent rather than erroring.
 */
export function renderSegment(input: RenderInput): string {
  const { cache, marker, run, usage, now, noColor } = input;
  const c = (code: number, s: string) => paint(noColor, code, s);

  const orn = c(COLOR.orn, '◈');
  const sep = c(COLOR.frame, ' ◆ ');
  const brand = c(COLOR.orn, 'specship');

  const parts: string[] = [];

  // Degraded paths: no project / no cache → idle, but still surface calls if known.
  if (!cache || !cache.initialized) {
    const label = cache && !cache.initialized ? 'indexing…' : 'idle';
    parts.push(c(COLOR.dim, label));
  } else {
    // Sync state — ✓ synced, or ⟳N pending.
    const pending = cache.pending.added + cache.pending.modified + cache.pending.removed;
    parts.push(pending === 0
      ? c(COLOR.synced, '✓ synced')
      : c(COLOR.pending, `⟳ ${pending} pending`));

    // Drift queue, only when non-zero.
    if (cache.drift > 0) parts.push(c(COLOR.drift, `⚠ ${cache.drift} drift`));

    // Backend health — flag a degraded (non-WAL) DB where reads can block.
    if (cache.degraded) parts.push(c(COLOR.wasm, `⚠ ${cache.backend}`));
  }

  // Session call count — the honest usage signal. Zero placeholder when no marker.
  const calls = marker ? marker.calls : 0;
  parts.push(c(COLOR.calls, `${calls} ${calls === 1 ? 'call' : 'calls'}`));

  // Active workflow run, only when one exists.
  if (run) {
    const label = run.specId ? `${run.specId}·${run.status}` : run.status;
    parts.push(c(COLOR.run, label));
  }

  // Usage-limit sub-segment (REQ-STATUSLINE-008) — ONLY for windows with real
  // numbers; SpecShip never estimates. `now` formats reset times in local time.
  if (usage && now != null) {
    const win = (label: string, w: { pctUsed: number; resetAt: number } | null) => {
      if (!w) return;
      const reset = Number.isFinite(w.resetAt) ? ` ${formatReset(w.resetAt, now)}` : '';
      parts.push(c(COLOR.calls, `${label} ${bar(w.pctUsed)} ${Math.round(w.pctUsed)}%${reset}`));
    };
    win('5h', usage.session);
    win('7d', usage.weekly);
  }

  return `${orn} ${brand}${sep}${parts.join(sep)} ${orn}`;
}
