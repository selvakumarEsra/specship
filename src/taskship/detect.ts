/**
 * taskship availability detection (TASKSHIP-BRIDGE-DOC, REQ-TASKSHIP-002).
 *
 * taskship is a sibling PM tool. When it's present, SpecShip routes newly
 * discovered tasks through it so its `plan.yaml` stays the single source of
 * truth; when absent, SpecShip writes JIRA directly. This module answers only
 * one question — "is taskship available here?" — from injected probes, so the
 * routing decision (REQ-TASKSHIP-003) is deterministic and unit-testable
 * without a live taskship.
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export interface TaskshipAvailability {
  available: boolean;
  /** How it was found — for the caller's user-facing note. Null when absent. */
  via: 'cli' | 'mcp' | null;
}

/** Injected signals — no I/O of the detector's own (REQ-TASKSHIP-002.A2). */
export interface TaskshipProbes {
  /** Whether the `taskship` command resolves on PATH. */
  commandOnPath: (cmd: string) => boolean;
  /** Whether a `taskship` MCP server is configured for the project. */
  mcpConfigured: () => boolean;
}

/**
 * Decide taskship availability from the probes (REQ-TASKSHIP-002). Pure: the
 * only inputs are the injected probes, and it never throws. CLI wins the
 * `via` label because a spawnable binary is what the router actually uses.
 */
export function detectTaskship(probes: TaskshipProbes): TaskshipAvailability {
  let cli = false;
  let mcp = false;
  try { cli = probes.commandOnPath('taskship'); } catch { cli = false; }
  try { mcp = probes.mcpConfigured(); } catch { mcp = false; }
  if (cli) return { available: true, via: 'cli' };
  if (mcp) return { available: true, via: 'mcp' };
  return { available: false, via: null };
}

/** Default PATH probe: `command -v` / `where`, exit code only. */
export function commandOnPath(cmd: string): boolean {
  try {
    const probe = process.platform === 'win32' ? `where ${cmd}` : `command -v ${cmd}`;
    execSync(probe, {
      stdio: 'ignore',
      windowsHide: true,
      shell: process.platform === 'win32' ? undefined : '/bin/sh',
    });
    return true;
  } catch {
    return false;
  }
}

/** Default MCP probe: a `taskship` server in the project's `.mcp.json`. */
export function mcpConfiguredIn(projectRoot: string): boolean {
  try {
    const raw = fs.readFileSync(path.join(projectRoot, '.mcp.json'), 'utf-8');
    const cfg = JSON.parse(raw) as { mcpServers?: Record<string, unknown> };
    return Boolean(cfg.mcpServers && cfg.mcpServers['taskship']);
  } catch {
    return false;
  }
}

/** Default probes bound to a project root (used by the MCP tool). */
export function defaultTaskshipProbes(projectRoot: string): TaskshipProbes {
  return {
    commandOnPath,
    mcpConfigured: () => mcpConfiguredIn(projectRoot),
  };
}
