/**
 * Rotating status-line usage tips (REQ-STATUSLINE-013).
 *
 * SpecShip's supported stand-in for Claude Code's built-in spinner tips — which
 * are hardcoded in the host and cannot be customized by a third party. A single
 * short, dimmed capability reminder is appended below the telemetry line and
 * advances on a fixed time interval.
 *
 * Pure by construction (REQ-STATUSLINE-013.A7): this module reads no clock, no
 * env, no filesystem, opens no database, and spawns nothing. The caller supplies
 * `now`; the renderer applies the dim styling. Selecting a tip is a table lookup.
 *
 * Honesty (REQ-STATUSLINE-013.A3): no tip states a tokens-, cost-, or
 * time-"saved" figure — the same fabrication ban as the identity line. Tips are
 * capability reminders, not benchmark claims.
 */

/** How long each tip stays on screen before the next rotates in (REQ-STATUSLINE-013.A2). */
export const STATUSLINE_TIP_INTERVAL_MS = 30_000;

/**
 * Curated one-line capability reminders, in rotation order. Each is short enough
 * for a single status-line row and free of any saved-figure claim (A3). At least
 * four distinct entries so the rotation is meaningful.
 */
export const STATUSLINE_TIPS: readonly string[] = [
  'specship_explore answers "how does X reach Y" in one call — no Read/Grep',
  'Name the symbols spanning a flow in specship_explore to trace the path between them',
  'specship_impact shows what a change would break before you make it',
  "specship_node returns a symbol's full body plus its caller/callee trail",
  'Ask specship_callers / specship_callees instead of grepping for usages',
  'Capture intent with /specship:spec, then /specship:spec implement it',
];

/**
 * The tip to show at `nowMs`, chosen by a fixed time bucket so it is stable
 * within an interval and never flickers on sub-second repaints
 * (REQ-STATUSLINE-013.A2): `floor(now / interval) mod count`, wrapping to the
 * first tip after the last. Pure — the clock is supplied by the caller.
 */
export function selectStatuslineTip(nowMs: number): string {
  const n = STATUSLINE_TIPS.length;
  const bucket = Math.floor(nowMs / STATUSLINE_TIP_INTERVAL_MS);
  // Guard against a negative `now` (pre-epoch clock) so the index stays in range.
  const idx = ((bucket % n) + n) % n;
  return STATUSLINE_TIPS[idx]!;
}
