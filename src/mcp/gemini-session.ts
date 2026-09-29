/**
 * Gemini CLI session model detection (LOWEND-DOC, REQ-LOWEND-001).
 *
 * All three existing tier-detection channels — the status-line marker, the
 * SessionStart hook seed, and the transcript tail — are Claude Code plumbing.
 * The Gemini target is MCP-entry-only (no hooks, no status line), so a Gemini
 * CLI session has to be read **in-server** from Gemini CLI's own configuration
 * surface:
 *
 *   GEMINI_MODEL (Gemini CLI's own env knob)
 *   <cwd>/.gemini/settings.json        — project, wins over global
 *   <homedir>/.gemini/settings.json    — global
 *
 * Gemini CLI has shipped both `"model": "gemini-3.5-flash"` and
 * `"model": { "name": "gemini-3.5-flash" }`, so both shapes are accepted.
 * Every read is best-effort: a missing file, malformed JSON, or a non-string
 * model yields `null` and the caller falls back to `full` — detection must
 * never error a tool call (REQ-LOWEND-001.A4).
 *
 * This module deliberately does NOT import the Gemini installer target: the
 * MCP read path must not depend on installer code. The paths mirror what that
 * target documents (Storage.getWorkspaceSettingsPath / getGlobalSettingsPath).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Gemini CLI's settings files for a workspace, project first (project settings
 * override global ones, same as Gemini CLI's own precedence).
 */
export function geminiSettingsPaths(cwd: string, homedir: string = os.homedir()): string[] {
  return [
    path.join(cwd, '.gemini', 'settings.json'),
    path.join(homedir, '.gemini', 'settings.json'),
  ];
}

interface CacheEntry {
  mtimeMs: number;
  size: number;
  model: string | null;
}

/**
 * Per-file parse cache keyed on path, invalidated by (mtimeMs, size).
 * Resolution runs per tool call; one `statSync` per settings file is the whole
 * cost on the warm path — JSON is re-parsed only when the file actually
 * changed (REQ-LOWEND-001: "cached with invalidation, never adding
 * perceptible latency").
 */
const cache = new Map<string, CacheEntry>();

/** Test seam — drops the parse cache. */
export function __resetGeminiCache(): void {
  cache.clear();
}

/** Pull a model id out of a parsed settings object, accepting both shapes. */
function modelFromSettings(parsed: unknown): string | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const model = (parsed as { model?: unknown }).model;
  if (typeof model === 'string' && model) return model;
  if (model && typeof model === 'object') {
    const name = (model as { name?: unknown }).name;
    if (typeof name === 'string' && name) return name;
  }
  return null;
}

/** Read one settings file through the cache. Never throws. */
function readSettingsModel(filePath: string): string | null {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return null;
    const hit = cache.get(filePath);
    if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) return hit.model;
    let model: string | null = null;
    try {
      model = modelFromSettings(JSON.parse(fs.readFileSync(filePath, 'utf-8')));
    } catch {
      model = null; // malformed JSON — degrade silently
    }
    cache.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size, model });
    return model;
  } catch {
    cache.delete(filePath);
    return null; // ENOENT, EACCES, a directory in the way — all just "unknown"
  }
}

/**
 * Host gate: the Gemini leg may only run inside a server that Gemini CLI
 * launched. The Gemini installer target stamps `SPECSHIP_HOST=gemini` into
 * the `mcpServers.specship` entry (written AND printed snippet), so the env
 * is present exactly in Gemini-launched server processes. Without this gate
 * a **Claude Code** session in a repo that happens to contain
 * `.gemini/settings.json` (or a shell exporting `GEMINI_MODEL`) would be
 * silently compacted during the first-prompt window before the Claude marker
 * exists — the exact crossover REQ-MODCTX-001.A6 closes on the Claude side.
 */
export function isGeminiHost(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SPECSHIP_HOST === 'gemini';
}

/**
 * Resolve the Gemini CLI session's model id, or null when nothing names one
 * (REQ-LOWEND-001). Host-gated: returns null outright unless
 * `SPECSHIP_HOST=gemini` (see `isGeminiHost`). Then env first, then project
 * settings, then global settings — first hit wins. The returned id is
 * verbatim; mapping it to a tier is `modelTier`'s job.
 */
export function readGeminiSessionModel(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
  homedir: string = os.homedir()
): string | null {
  if (!isGeminiHost(env)) return null;
  const fromEnv = env.GEMINI_MODEL;
  if (typeof fromEnv === 'string' && fromEnv.trim()) return fromEnv;
  for (const p of geminiSettingsPaths(cwd, homedir)) {
    const model = readSettingsModel(p);
    if (model) return model;
  }
  return null;
}
