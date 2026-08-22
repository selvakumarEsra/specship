/**
 * Google Gemini CLI target — Phase 1 (GEMINI-TARGET-DOC, REQ-GEMINI-002/003).
 *
 * Implements the full `AgentTarget` contract over exactly ONE surface:
 * Gemini CLI's `mcpServers` settings block. Everything the Claude target
 * additionally writes (permissions, auto-sync + steering hooks, slash
 * commands, the `specship-explorer` subagent, the status line, the CLAUDE.md
 * steering block) has no Gemini equivalent, so `install` writes none of it and
 * says so in `notes` rather than half-installing it (REQ-GEMINI-006).
 * GEMINI.md steering (REQ-GEMINI-004) and TOML commands (REQ-GEMINI-005) are
 * still unimplemented — deliberately absent, not faked.
 *
 * The target IS registered in `targets/registry.ts`, but a plain
 * `specship install` stays Claude-only: target selection is opt-in through
 * `--target gemini` (REQ-GEMINI-002.A4).
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

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  AgentTarget,
  DetectionResult,
  InstallOptions,
  Location,
  WriteResult,
} from './types';
import {
  getMcpServerConfig,
  jsonDeepEqual,
  readJsonFile,
  writeJsonFile,
} from './shared';

/** Gemini CLI's settings file for this location. */
export function settingsPath(loc: Location): string {
  return loc === 'global'
    ? path.join(os.homedir(), '.gemini', 'settings.json')
    : path.join(process.cwd(), '.gemini', 'settings.json');
}

/**
 * The `mcpServers.specship` entry as Gemini CLI wants it: the Claude entry
 * minus `type`, which Gemini restricts to `'sse' | 'http'` (a stdio server is
 * identified by having `command`). Single source for `install` AND
 * `printConfig`, so the pasted-by-hand snippet and the written entry can't
 * drift.
 */
function geminiEntry(integrations: string[] = []): Record<string, unknown> {
  const { type: _stdioIsImplied, ...server } = getMcpServerConfig(integrations);
  return server;
}

/**
 * Write the specship server into Gemini CLI's `mcpServers` block
 * (REQ-GEMINI-003). Same shape as the Claude target's `writeMcpEntry`:
 * sibling servers and unrelated settings keys are preserved, a byte-identical
 * re-run reports `unchanged`, and integrations a PREVIOUS install enabled are
 * unioned in so an upgrade never silently disables an opt-in
 * (REQ-GEMINI-003.A2, parity with REQ-INTEG-001.A3).
 */
export function writeGeminiMcpEntry(
  loc: Location,
  integrations: string[] = [],
): WriteResult['files'][number] {
  const file = settingsPath(loc);
  const existing = readJsonFile(file);
  const before = existing.mcpServers?.specship;

  const prior = typeof before?.env?.SPECSHIP_INTEGRATIONS === 'string'
    ? before.env.SPECSHIP_INTEGRATIONS.split(',').map((s: string) => s.trim()).filter(Boolean)
    : [];
  const after = geminiEntry([...new Set([...prior, ...integrations])]);

  if (jsonDeepEqual(before, after)) {
    return { path: file, action: 'unchanged' };
  }
  // `created` means the settings FILE did not exist. A pre-existing
  // settings.json holding other servers is `updated` — we added to it.
  const action: 'created' | 'updated' = before
    ? 'updated'
    : (fs.existsSync(file) ? 'updated' : 'created');
  if (!existing.mcpServers) existing.mcpServers = {};
  existing.mcpServers.specship = after;
  writeJsonFile(file, existing);
  return { path: file, action };
}

/**
 * What a Claude install provides that this one does not (REQ-GEMINI-006.A1).
 * One note, naming every unsupported surface, so the gap is explicit at
 * install time instead of discovered as a missing feature later.
 */
const CAPABILITY_NOTE =
  'Gemini CLI install wires the MCP server only. No auto-sync/steering hooks, ' +
  'no slash commands, no specship-explorer subagent, no status line, and no ' +
  'permissions auto-allow — Gemini CLI has no equivalent surface. Retrieval ' +
  'steering therefore relies solely on the MCP server instructions.';

export class GeminiCliTarget implements AgentTarget {
  readonly id = 'gemini' as const;
  readonly displayName = 'Gemini CLI';
  readonly docsUrl = 'https://google-gemini.github.io/gemini-cli/docs/cli/configuration.html';

  supportsLocation(_loc: Location): boolean {
    return true;
  }

  /**
   * REQ-GEMINI-002.A1. `installed` is the same cheap heuristic the Claude
   * target uses — the config dir (or the settings file) being present — rather
   * than shelling out to `gemini --version`.
   */
  detect(loc: Location): DetectionResult {
    const file = settingsPath(loc);
    const config = readJsonFile(file);
    return {
      installed: fs.existsSync(path.dirname(file)) || fs.existsSync(file),
      alreadyConfigured: !!config.mcpServers?.specship,
      configPath: file,
    };
  }

  /**
   * Writes exactly one thing: the MCP entry. `autoAllow`, `sdd` and
   * `installStatusLine` are accepted and IGNORED — Gemini CLI has no
   * permissions, hooks or commands surface to write them to, and faking one
   * would be worse than the note (REQ-GEMINI-006). Nothing under `.claude/`
   * is ever touched (REQ-GEMINI-006.A2).
   */
  install(loc: Location, opts: InstallOptions): WriteResult {
    const integrations: string[] = [
      ...(opts.withJira ? ['jira'] : []),
      ...(opts.withDesigner ? ['designer'] : []),
    ];
    return {
      files: [writeGeminiMcpEntry(loc, integrations)],
      notes: [CAPABILITY_NOTE],
    };
  }

  /**
   * Removes only the `mcpServers.specship` key (REQ-GEMINI-002.A2): sibling
   * servers and every unrelated settings key survive byte-identical, and
   * uninstalling a location that was never installed reports `not-found`
   * rather than throwing.
   */
  uninstall(loc: Location): WriteResult {
    const file = settingsPath(loc);
    const config = readJsonFile(file);
    if (!config.mcpServers?.specship) {
      return { files: [{ path: file, action: 'not-found' }] };
    }
    delete config.mcpServers.specship;
    if (Object.keys(config.mcpServers).length === 0) delete config.mcpServers;
    writeJsonFile(file, config);
    return { files: [{ path: file, action: 'removed' }] };
  }

  /**
   * The snippet, verbatim-pasteable into `mcpServers`. Pure string building —
   * touches nothing on disk (REQ-GEMINI-001.A1).
   */
  printConfig(loc: Location): string {
    const snippet = JSON.stringify({ mcpServers: { specship: geminiEntry() } }, null, 2);
    return `# Add to ${settingsPath(loc)}\n\n${snippet}\n`;
  }

  describePaths(loc: Location): string[] {
    return [settingsPath(loc)];
  }
}

export const geminiTarget = new GeminiCliTarget();
