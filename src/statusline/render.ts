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

/**
 * Context-header inputs (REQ-STATUSLINE-012). Every field is already resolved to
 * a display string by the caller (the model name, the `~`-abbreviated working
 * directory, the git branch, and the Claude Code version) so this module stays
 * pure — no env, no clock, no I/O. Each is null/absent when its source is
 * missing, and the element is then dropped. The caller passes `header: null`
 * (no header at all) when stdin does not identify the session, which preserves
 * the single degraded line of REQ-STATUSLINE-001.A2.
 */
export interface HeaderInput {
  model?: string | null;
  /** Working directory, already home-abbreviated to `~` by the caller. */
  dir?: string | null;
  branch?: string | null;
  /** Claude Code version string (rendered as `v<version>`). */
  version?: string | null;
}

export interface RenderInput {
  cache: StatuslineCache | null;
  marker: SessionMarker | null;
  run: ActiveRun | null;
  /**
   * Context header stacked ABOVE the identity line (REQ-STATUSLINE-012), or
   * null/undefined to omit the header line entirely. The caller supplies null
   * when stdin carries no `model`/`version` (empty or unparseable stdin), so the
   * degraded path stays one line.
   */
  header?: HeaderInput | null;
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
  /**
   * Claude's `context_window.used_percentage` (0-100) from stdin, or null/undefined
   * to omit the CTX element (REQ-STATUSLINE-009). SpecShip never fabricates it.
   */
  context?: number | null;
  /** Context-usage warning threshold (percent); CTX escalates at/above it. */
  ctxWarnPct?: number;
  /** When true, emit no ANSI escapes. */
  noColor: boolean;
}

/** A 5-cell art-deco bar (`❮▰▱❯`) depicting `pct` (0-100) capacity used. */
function bar(pct: number): string {
  const cells = 5;
  const filled = Math.max(0, Math.min(cells, Math.round((pct / 100) * cells)));
  return `❮${'▰'.repeat(filled)}${'▱'.repeat(cells - filled)}❯`;
}

/** Compact duration for the run ETA element: `4m`, `1h20m`, `<1m`. */
function fmtEtaDur(ms: number): string {
  const m = Math.round(ms / 60_000);
  if (m < 1) return '<1m';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h}h` : `${h}h${rest}m`;
}

/**
 * ETA suffix for the active-run element (REQ-STATUSLINE-011): a compact
 * range for a running run, a waiting signal for a gated one, '' when the
 * marker carries no estimate (older writer / no history).
 */
function etaSuffix(run: ActiveRun): string {
  const eta = run.eta;
  if (!eta) return '';
  if (eta.kind === 'range') {
    const low = fmtEtaDur(eta.lowMs);
    const high = fmtEtaDur(eta.highMs);
    return low === high ? ` ≈${low} left` : ` ≈${low}–${high} left`;
  }
  if (eta.kind === 'waiting') return ' waiting on you';
  return '';
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
  const { cache, marker, run, usage, now, context, ctxWarnPct, noColor, header } = input;
  const c = (code: number, s: string) => paint(noColor, code, s);

  const orn = c(COLOR.orn, '◈');
  const sep = c(COLOR.frame, ' ◆ ');
  const brand = c(COLOR.orn, 'specship');

  // Context header (REQ-STATUSLINE-012) — model · directory · branch · version,
  // stacked above the identity line. Each element drops out when absent; the
  // whole line is omitted when `header` is null or has no populated element, so
  // the degraded single-line path (REQ-STATUSLINE-001.A2) is preserved.
  let headerLine: string | null = null;
  if (header) {
    const hp: string[] = [];
    if (header.model) hp.push(c(COLOR.calls, header.model));
    if (header.dir) hp.push(c(COLOR.frame, header.dir));
    if (header.branch) hp.push(c(COLOR.run, `⎇ ${header.branch}`));
    if (header.version) hp.push(c(COLOR.dim, `v${header.version}`));
    if (hp.length > 0) headerLine = `${orn} ${hp.join(sep)} ${orn}`;
  }

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

  // Active workflow run, only when one exists — with its remaining-time
  // estimate when the marker carries one (REQ-STATUSLINE-011).
  if (run) {
    const label = run.specId ? `${run.specId}·${run.status}` : run.status;
    parts.push(c(COLOR.run, `${label}${etaSuffix(run)}`));
  }

  // Telemetry elements render on their own SECOND line (REQ-STATUSLINE-010):
  // the SpecShip identity stays scannable while capacity bars get room.
  const telemetry: string[] = [];

  // Context-usage element (REQ-STATUSLINE-009) — Claude's real context %, with
  // an escalating compaction warning past the threshold. Advisory only;
  // SpecShip cannot compact. Omitted when no real percentage is available.
  if (context != null && Number.isFinite(context)) {
    const warn = context >= (ctxWarnPct ?? 80);
    const color = warn ? COLOR.pending : COLOR.calls; // amber when high, else gold
    const hint = warn ? ' ⚠ compact' : '';
    telemetry.push(c(color, `CTX ${bar(context)} ${Math.round(context)}%${hint}`));
  }

  // Usage-limit sub-segment (REQ-STATUSLINE-008) — ONLY for windows with real
  // numbers; SpecShip never estimates. `now` formats reset times in local time.
  if (usage && now != null) {
    const win = (label: string, w: { pctUsed: number; resetAt: number } | null) => {
      if (!w) return;
      const reset = Number.isFinite(w.resetAt) ? ` ${formatReset(w.resetAt, now)}` : '';
      telemetry.push(c(COLOR.calls, `${label} ${bar(w.pctUsed)} ${Math.round(w.pctUsed)}%${reset}`));
    };
    win('5h', usage.session);
    win('7d', usage.weekly);
  }

  const identityLine = `${orn} ${brand}${sep}${parts.join(sep)} ${orn}`;
  const telemetryLine = telemetry.length > 0 ? `${orn} ${telemetry.join(sep)} ${orn}` : null;

  // Fixed stack order: header, identity, telemetry (REQ-STATUSLINE-010). The
  // identity line is always present; the two optional lines collapse out so
  // there is never a leading/trailing/interior blank line.
  const lines = [headerLine, identityLine, telemetryLine].filter((l): l is string => l !== null);
  return lines.join('\n');
}
