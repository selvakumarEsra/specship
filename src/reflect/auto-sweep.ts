/**
 * Guarded automatic reflection sweep (REQ-ALEARN-004).
 *
 * The sweep piggybacks on `specship sync` so learning fires on its own —
 * autoharness's defining trait — but stays invisible: a persisted cooldown
 * (default 6 h) bounds it, `reflect.autoSweep: false` in specship.config.json
 * opts out, and the caller swallows every error (A3: a sweep failure never
 * blocks or fails a sync).
 */

import * as fs from 'fs';
import * as path from 'path';

export interface ReflectConfigFile {
  /** false → the automatic sweep never runs (on-demand paths unaffected). */
  autoSweep?: boolean;
  /** Cooldown between automatic sweeps, in hours. Default 6. */
  sweepCooldownHours?: number;
}

export const DEFAULT_SWEEP_COOLDOWN_HOURS = 6;

const STATE_FILE = (projectRoot: string): string =>
  path.join(projectRoot, '.specship', 'reflect-sweep.json');

/**
 * Load the `reflect` key from `specship.config.json` — missing/unparseable →
 * `{}` (auto-sweep on, default cooldown), mirroring `loadEnforceConfig`.
 */
export function loadReflectConfig(projectRoot: string): ReflectConfigFile {
  try {
    const raw = fs.readFileSync(path.join(projectRoot, 'specship.config.json'), 'utf-8');
    const cfg = JSON.parse(raw) as { reflect?: ReflectConfigFile };
    if (cfg?.reflect && typeof cfg.reflect === 'object') return cfg.reflect;
  } catch {
    // no config / unparseable → defaults
  }
  return {};
}

/** Whether an automatic sweep is due now (REQ-ALEARN-004.A1). */
export function shouldAutoSweep(projectRoot: string, nowMs: number, cfg: ReflectConfigFile): boolean {
  if (cfg.autoSweep === false) return false;
  const cooldownMs = (cfg.sweepCooldownHours ?? DEFAULT_SWEEP_COOLDOWN_HOURS) * 60 * 60_000;
  try {
    const state = JSON.parse(fs.readFileSync(STATE_FILE(projectRoot), 'utf-8')) as { lastSweepAt?: number };
    if (typeof state.lastSweepAt === 'number') return nowMs - state.lastSweepAt >= cooldownMs;
  } catch {
    // no state yet → due
  }
  return true;
}

/** Persist the sweep timestamp so the cooldown survives processes. */
export function recordAutoSweep(projectRoot: string, nowMs: number): void {
  const file = STATE_FILE(projectRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ lastSweepAt: nowMs }) + '\n');
}
