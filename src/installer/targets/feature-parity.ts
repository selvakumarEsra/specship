/**
 * Claude Code → Gemini CLI feature-parity map (REQ-AGENTSWITCH-010).
 *
 * Data only. Every kind of artifact the Claude Code target installs
 * (`CLAUDE_ARTIFACT_KINDS` in `./claude`) maps to exactly one entry here:
 *
 *   - `gemini`    — the Gemini CLI surface that provides the same feature;
 *   - `limited`   — (with `gemini`) a caveat the user must act on for the
 *                   surface to work; the install already prints it;
 *   - `noSurface` — Gemini CLI has no equivalent at all. The install names
 *                   it in one output line with this reason, never silently.
 *
 * Lives under `targets/` (the adapter layer) because the Gemini-side
 * descriptions name Gemini surfaces; shared code never reads it.
 */
import type { ClaudeArtifactKind } from './claude';

export type ParityEntry =
  | { surface: string; gemini: string; limited?: string }
  | { surface: string; noSurface: string };

export const GEMINI_PARITY: Readonly<Record<ClaudeArtifactKind, ParityEntry>> = Object.freeze({
  mcp: { surface: 'MCP server', gemini: 'mcpServers.specship in Gemini settings.json' },
  permissions: {
    surface: 'Read-only tool auto-allow',
    gemini: 'user-tier policy ~/.gemini/policies/specship.toml (written on --trust, or on a switch from an auto-allow install)',
  },
  'sync-hooks': { surface: 'Auto-sync hooks', gemini: 'SessionStart / AfterTool hooks in Gemini settings.json' },
  'sdd-instructions': { surface: 'SDD memory block', gemini: 'marker-delimited SDD block in GEMINI.md' },
  'sdd-hook': { surface: 'SDD prompt nudge', gemini: 'BeforeAgent hook in Gemini settings.json' },
  'steer-hook': { surface: 'Retrieval steering nudge', gemini: 'BeforeAgent hook in Gemini settings.json' },
  'search-intercept-hook': {
    surface: 'Search interceptor',
    gemini: 'BeforeTool hook on grep_search / glob / run_shell_command',
  },
  commands: { surface: '/specship:* commands', gemini: 'TOML commands under .gemini/commands/specship/' },
  agents: {
    surface: 'specship-explorer subagent',
    gemini: 'agent file under .gemini/agents/ (Gemini CLI >= 0.28.0)',
    limited: 'Gemini subagents are experimental — experimental.enableAgents must be set to true by the user',
  },
  skills: { surface: 'Skills', gemini: 'skill dirs under .gemini/skills/ (Gemini CLI >= 0.28.0)' },
  statusline: { surface: 'Status line', noSurface: 'no equivalent surface' },
});

/** One install-output line per feature Gemini CLI has no surface for. */
export function noSurfaceNotes(): string[] {
  return Object.values(GEMINI_PARITY).flatMap((e) =>
    'noSurface' in e ? [`${e.surface}: unavailable in Gemini CLI — ${e.noSurface}.`] : [],
  );
}
