/**
 * Host profiles for the dashboard server (AGENTSWITCH-DOC, REQ-AGENTSWITCH-001).
 *
 * The server's adapter layer: every per-agent file name and path the
 * dashboard reads lives here, so routes loop over the profiles instead of
 * naming one agent. Kept server-local on purpose — the server must not
 * runtime-import values from the core package (a bare-package import serves
 * a stale build). The values mirror `src/activation/hook-output.ts`'s
 * `HostTraits`, which stays the source of truth; a unit test pins the two
 * together.
 */
import path from 'node:path';

export type HostId = 'claude' | 'gemini';

export interface ServerHostProfile {
  id: HostId;
  displayName: string;
  /** Memory file name at user / project / subdirectory level. */
  memoryFile: string;
  /** Per-user and per-project config directory name. */
  configDir: string;
  /** User-wide MCP config file, relative to the home dir. */
  userConfigFile: string;
  /** Project MCP config file, relative to the project root. */
  projectMcpFile: string;
  /** Managed (read-only, admin) memory file locations, first hit wins. */
  enterpriseMemoryPaths: () => string[];
  /** Agent-written memory notes directory, relative to the home dir; null when the agent has none. */
  notesDir: string | null;
}

export const CLAUDE_PROFILE: ServerHostProfile = {
  id: 'claude',
  displayName: 'Claude Code',
  memoryFile: 'CLAUDE.md',
  configDir: '.claude',
  userConfigFile: '.claude.json',
  projectMcpFile: '.mcp.json',
  enterpriseMemoryPaths: () => [
    '/Library/Application Support/ClaudeCode/CLAUDE.md',
    '/etc/ClaudeCode/CLAUDE.md',
    process.env['ProgramData'] ? path.join(process.env['ProgramData']!, 'ClaudeCode', 'CLAUDE.md') : '',
  ].filter(Boolean),
  notesDir: path.join('.claude', 'memory'),
};

export const GEMINI_PROFILE: ServerHostProfile = {
  id: 'gemini',
  displayName: 'Gemini CLI',
  memoryFile: 'GEMINI.md',
  configDir: '.gemini',
  userConfigFile: path.join('.gemini', 'settings.json'),
  projectMcpFile: path.join('.gemini', 'settings.json'),
  enterpriseMemoryPaths: () => [],
  // Gemini's memory tool appends to the user GEMINI.md, not a notes dir.
  notesDir: null,
};

/** Every profile, Claude Code first (the default host). */
export const HOST_PROFILES: readonly ServerHostProfile[] = [CLAUDE_PROFILE, GEMINI_PROFILE];
