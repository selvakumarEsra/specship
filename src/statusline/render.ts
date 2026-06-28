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

import { StatuslineCache, SessionMarker, ActiveRun } from './types';

export interface RenderInput {
  cache: StatuslineCache | null;
  marker: SessionMarker | null;
  run: ActiveRun | null;
  /** When true, emit no ANSI escapes. */
  noColor: boolean;
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
  const { cache, marker, run, noColor } = input;
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

  return `${orn} ${brand}${sep}${parts.join(sep)} ${orn}`;
}
