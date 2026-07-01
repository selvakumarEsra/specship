/**
 * Usage-limit reader (REQ-STATUSLINE-008).
 *
 * The PRIMARY source is Claude Code's status-line stdin `rate_limits` object,
 * which carries real per-window `used_percentage` and `resets_at` (Unix epoch
 * seconds) for `five_hour` and `seven_day` (Pro/Max only, after the first API
 * response; windows independently optional) — see `usageFromStatuslineInput`.
 *
 * An external file (`$SPECSHIP_USAGE_FILE` / `~/.specship/usage-limits.json`) is
 * an OPTIONAL override read by `readUsageLimits`, for setups where the stdin
 * `rate_limits` aren't present.
 *
 * Either way SpecShip never estimates: a window with no real data is null and
 * the segment omits it. Read path only — bounded reads, no database, no
 * subprocess, no network (same budget as REQ-STATUSLINE-002).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { UsageLimits, UsageWindow } from './types';

/**
 * Parse Claude Code's status-line stdin JSON into usage limits. Maps each
 * window's `used_percentage` to percent-REMAINING and `resets_at` (epoch
 * seconds) to ms. Returns null when `rate_limits` is absent or unparseable;
 * either window may be independently null.
 */
export function usageFromStatuslineInput(raw: string): UsageLimits | null {
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  const rl = json.rate_limits;
  if (!rl || typeof rl !== 'object') return null;
  const rec = rl as Record<string, unknown>;
  const session = windowFromRateLimit(rec.five_hour);
  const weekly = windowFromRateLimit(rec.seven_day);
  if (!session && !weekly) return null;
  return { session, weekly };
}

/**
 * Parse Claude Code's status-line stdin JSON for context-window usage
 * (REQ-STATUSLINE-009). Returns `context_window.used_percentage` (0-100) or null
 * when it's absent, null (early session), or unparseable.
 */
export function contextFromStatuslineInput(raw: string): number | null {
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  const cw = json.context_window;
  if (!cw || typeof cw !== 'object') return null;
  const used = (cw as Record<string, unknown>).used_percentage;
  if (typeof used !== 'number' || !Number.isFinite(used)) return null;
  return Math.max(0, Math.min(100, used));
}

/** Default context-usage warning threshold (percent). */
const DEFAULT_CTX_WARN_PCT = 80;

/**
 * Resolve the context-usage warning threshold from `SPECSHIP_CTX_WARN_PCT`
 * (REQ-STATUSLINE-009), falling back to the default when unset, non-numeric, or
 * out of the 0-100 range.
 */
export function resolveCtxWarnPct(raw: string | undefined = process.env.SPECSHIP_CTX_WARN_PCT): number {
  if (raw == null || raw.trim() === '') return DEFAULT_CTX_WARN_PCT;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 100) return DEFAULT_CTX_WARN_PCT;
  return n;
}

/** One `rate_limits.{five_hour,seven_day}` entry → a remaining-capacity window. */
function windowFromRateLimit(w: unknown): UsageWindow | null {
  if (!w || typeof w !== 'object') return null;
  const rec = w as Record<string, unknown>;
  const used = rec.used_percentage;
  if (typeof used !== 'number' || !Number.isFinite(used)) return null;
  const pctUsed = Math.max(0, Math.min(100, used));
  // resets_at is Unix epoch SECONDS; may be absent → NaN (bar shows, reset omitted).
  const resetAt = typeof rec.resets_at === 'number' && Number.isFinite(rec.resets_at) ? rec.resets_at * 1000 : NaN;
  return { pctUsed, resetAt };
}

/** Default freshness window: data older than this is treated as not-real. */
const DEFAULT_FRESHNESS_MS = 15 * 60 * 1000;

export interface ReadUsageOptions {
  /** Override the file path (defaults to `$SPECSHIP_USAGE_FILE` or `~/.specship/usage-limits.json`). */
  file?: string;
  /** Current time in ms epoch (defaults to `Date.now()`); injectable for tests. */
  now?: number;
  /** Freshness window in ms (defaults to 15 minutes). */
  freshnessMs?: number;
}

/** The well-known usage file an external tool writes. */
export function usageFilePath(): string {
  return process.env.SPECSHIP_USAGE_FILE || path.join(os.homedir(), '.specship', 'usage-limits.json');
}

function parseWindow(w: unknown): UsageWindow | null {
  if (!w || typeof w !== 'object') return null;
  const rec = w as Record<string, unknown>;
  const pct = rec.pctUsed;
  if (typeof pct !== 'number' || !Number.isFinite(pct) || pct < 0 || pct > 100) return null;
  const reset = typeof rec.resetAt === 'string' ? Date.parse(rec.resetAt) : NaN;
  if (!Number.isFinite(reset)) return null;
  return { pctUsed: pct, resetAt: reset };
}

/**
 * Read + validate the usage file. Returns validated, fresh limits, or null when
 * the data is not real (absent / unreadable / bad JSON / missing field / stale).
 */
export function readUsageLimits(opts: ReadUsageOptions = {}): UsageLimits | null {
  const file = opts.file ?? usageFilePath();
  const now = opts.now ?? Date.now();
  const freshnessMs = opts.freshnessMs ?? DEFAULT_FRESHNESS_MS;

  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return null; // absent / unreadable
  }

  let json: Record<string, unknown>;
  try {
    json = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null; // not valid JSON
  }

  const updated = typeof json.updatedAt === 'string' ? Date.parse(json.updatedAt) : NaN;
  if (!Number.isFinite(updated)) return null;
  if (now - updated > freshnessMs) return null; // stale

  const session = parseWindow(json.session);
  const weekly = parseWindow(json.weekly);
  if (!session || !weekly) return null; // incomplete

  return { session, weekly };
}
