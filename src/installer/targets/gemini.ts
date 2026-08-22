/**
 * Google Gemini CLI target — PHASE 0 ONLY (GEMINI-TARGET-DOC, REQ-GEMINI-001).
 *
 * Right now this target can do exactly one thing: PRINT the `mcpServers`
 * snippet a Gemini CLI user pastes into their settings file by hand.
 * `detect` / `install` / `uninstall` are Phase 1 (REQ-GEMINI-002) and throw
 * until then, which is also why this target is deliberately NOT registered in
 * `targets/registry.ts` — a plain `specship install` must keep behaving
 * byte-identically to the Claude-only installer (REQ-GEMINI-002.A4), and the
 * contract suite in `__tests__/installer-targets.test.ts` iterates every
 * registered target.
 *
 * Schema provenance (REQ-GEMINI-001: "MUST NOT be invented from memory"):
 * verified against `@google/gemini-cli` **0.56.0** (npm latest, 2026-08-22;
 * cross-checked against 0.28.0) by reading the shipped
 * `config/settingsSchema.js` and the `MCPServerConfig` class:
 *
 *   - settings key: `mcpServers`, an object of server-name → MCPServerConfig
 *   - stdio fields: `command`, `args`, `env`, `cwd`
 *   - `type` is `'sse' | 'http'` ONLY — a stdio server is identified by
 *     having `command`, so we must NOT copy the Claude entry's
 *     `type: 'stdio'` across (the one place this diverges from the Claude
 *     snippet; command/args/env stay identical by construction because both
 *     come from `shared.ts:getMcpServerConfig`).
 *   - locations: global `~/.gemini/settings.json` (Storage.getGlobalSettingsPath),
 *     project `<cwd>/.gemini/settings.json` (Storage.getWorkspaceSettingsPath).
 */

import * as os from 'os';
import * as path from 'path';
import {
  AgentTarget,
  DetectionResult,
  InstallOptions,
  Location,
  WriteResult,
} from './types';
import { getMcpServerConfig } from './shared';

/** Gemini CLI's settings file for this location. */
export function settingsPath(loc: Location): string {
  return loc === 'global'
    ? path.join(os.homedir(), '.gemini', 'settings.json')
    : path.join(process.cwd(), '.gemini', 'settings.json');
}

/** Thrown by every not-yet-implemented surface, so a caller fails loudly. */
const PHASE_1 = 'Gemini install lands in REQ-GEMINI-002';

export class GeminiCliTarget implements AgentTarget {
  readonly id = 'gemini' as const;
  readonly displayName = 'Gemini CLI';
  readonly docsUrl = 'https://google-gemini.github.io/gemini-cli/docs/cli/configuration.html';

  supportsLocation(_loc: Location): boolean {
    return true;
  }

  detect(_loc: Location): DetectionResult {
    throw new Error(PHASE_1);
  }

  install(_loc: Location, _opts: InstallOptions): WriteResult {
    throw new Error(PHASE_1);
  }

  uninstall(_loc: Location): WriteResult {
    throw new Error(PHASE_1);
  }

  /**
   * The snippet, verbatim-pasteable into `mcpServers`. Pure string building —
   * touches nothing on disk (REQ-GEMINI-001.A1).
   */
  printConfig(loc: Location): string {
    const { type: _stdio, ...server } = getMcpServerConfig();
    const snippet = JSON.stringify({ mcpServers: { specship: server } }, null, 2);
    return `# Add to ${settingsPath(loc)}\n\n${snippet}\n`;
  }

  describePaths(loc: Location): string[] {
    return [settingsPath(loc)];
  }
}

export const geminiTarget = new GeminiCliTarget();
