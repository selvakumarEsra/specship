/**
 * Shared helpers for hook commands (`steer-nudge`, `spec-nudge`,
 * `search-intercept`) that read a hook payload from stdin and emit a
 * `hookSpecificOutput.additionalContext` line.
 *
 * The `hook_event_name` field is echoed back from the payload rather than
 * hard-coded so the same CLI command serves Claude Code's event names
 * (`UserPromptSubmit`, `PreToolUse`) AND Gemini CLI's (`BeforeAgent`,
 * `BeforeTool`) — the installer wires them to the same binaries and the
 * payload tells the command which host called it (REQ-GEMINI-010).
 */

import * as fs from 'fs';
import * as path from 'path';
import { agentFromHookEvent, type DetectedAgent } from '../agents/detect';

export interface HookPayload {
  prompt: string;
  cwd: string | null;
  sessionId: string | null;
  transcriptPath: string | null;
  hookEventName: string | null;
}

export function parseHookPayload(raw: string): HookPayload {
  const empty: HookPayload = {
    prompt: '',
    cwd: null,
    sessionId: null,
    transcriptPath: null,
    hookEventName: null,
  };
  const trimmed = raw.trim();
  if (!trimmed) return empty;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    // Not JSON — treat the raw text as the prompt body.
    return { ...empty, prompt: trimmed };
  }
  if (!parsed || typeof parsed !== 'object') return empty;
  const p = parsed as Record<string, unknown>;
  const str = (v: unknown): string | null =>
    typeof v === 'string' && v.length > 0 ? v : null;
  return {
    prompt: typeof p.prompt === 'string' ? p.prompt : '',
    cwd: str(p.cwd),
    sessionId: str(p.session_id),
    transcriptPath: str(p.transcript_path),
    hookEventName: str(p.hook_event_name),
  };
}

/**
 * Build a `hookSpecificOutput.additionalContext` JSON line. `eventName` is
 * echoed from the payload when present (so Gemini's `BeforeAgent` /
 * `BeforeTool` names round-trip) and falls back to `fallbackEventName` only
 * when the payload carries none.
 */
export function buildHookAdditionalContext(
  additionalContext: string,
  eventName: string | null,
  fallbackEventName: string,
): string {
  const hookEventName = eventName ?? fallbackEventName;
  return (
    JSON.stringify({ hookSpecificOutput: { hookEventName, additionalContext } }) +
    '\n'
  );
}

/**
 * A blocking decision for a host whose before-tool hook reads a TOP-LEVEL
 * `decision` (Gemini CLI 0.28.0 `BeforeToolHookOutput.isBlockingDecision`
 * checks `this.decision === 'block' || 'deny'`; nested under
 * `hookSpecificOutput` it is ignored). Only emitted for hosts whose traits
 * report `supportsBeforeToolDeny`.
 */
export function buildHookDenyDecision(reason: string): string {
  return JSON.stringify({ decision: 'deny', reason }) + '\n';
}

/**
 * Host-shaped traits derived from a hook payload — the one place that peeks
 * at `hook_event_name` to decide whether we're serving Claude Code or Gemini
 * CLI. Shared code (`search-intercept`, `bin/specship`) consumes the traits
 * and never event-name-sniffs itself, keeping it host-agnostic per the
 * project's agent-agnostic rule.
 *
 *   - `specshipToolMarkers` — substrings naming a specship tool_use record.
 *     Claude exposes our server as `mcp__specship__<tool>`; Gemini shows
 *     the model the bare tool name (`specship_explore`), qualifying it as
 *     `specship__<tool>` only on a name collision; from 0.33.0 the name is
 *     `mcp_specship_<tool>`.
 *   - `transcriptFormat` — Claude writes JSONL (one record per line); Gemini's
 *     `ChatRecordingService` writes one pretty-printed JSON doc with
 *     `messages[].toolCalls[].name` (JSON Lines from 0.33.0, which the
 *     single-json scan also reads).
 *   - `supportsBeforeToolDeny` — whether the host reads a top-level
 *     `{decision:'deny'}` on its BeforeTool-equivalent. Gemini 0.28.0+
 *     `BeforeToolHookOutput.isBlockingDecision` does; Claude's PreToolUse
 *     uses a different shape so we never emit deny for Claude.
 */
export interface HostTraits {
  /** Adapter id — the same ids as the install record and `--target` (REQ-AGENTSWITCH-001). */
  id: 'claude' | 'gemini';
  /** Human-readable product name for agent- and user-facing text. */
  displayName: string;
  /** The project/user memory file the host reads (`<root>/<memoryFile>`). */
  memoryFile: string;
  /** The host's per-project and per-user config directory name. */
  configDir: string;
  /** User-wide config file holding MCP server entries, relative to the home dir. */
  userConfigFile: string;
  /** Session transcript root, relative to the home dir. */
  transcriptDir: string;
  /** The host's built-in file-read tools. */
  readTools: readonly string[];
  /** The host's built-in code-search tools. */
  searchTools: readonly string[];
  specshipToolMarkers: string[];
  transcriptFormat: 'jsonl' | 'single-json';
  supportsBeforeToolDeny: boolean;
  /**
   * Prefix the host puts in front of a SpecShip tool name when the model
   * calls it (AGENTADAPT-DOC, REQ-AGENTADAPT-001): agent-facing text renders
   * `${toolPrefix}specship_explore` so each host sees its own tool name.
   */
  toolPrefix: string;
  /** Event names to answer with when the payload names none (REQ-AGENTADAPT-002). */
  fallbackPromptEvent: string;
  fallbackToolEvent: string;
  /** The host's own built-in search tools a strict interceptor may redirect. */
  denyEligibleTools: readonly string[];
  /** The host's shell tool, whose `command` the interceptor classifies. */
  shellTool: string | null;
  /** Project settings file holding hook entries, relative to the project root (REQ-AGENTSWITCH-003). */
  projectSettingsFile: string;
  /** The host's after-tool hook event a post-edit hook registers under. */
  postEditEvent: string;
  /** Hook matcher naming the host's built-in file-write tools. */
  writeToolMatcher: string;
  /**
   * User-wide memory-notes directory, relative to the home dir; `null` when
   * the host has none (portable memory rules then go to {@link userMemoryFile}).
   */
  memoryNotesDir: string | null;
  /** User-wide memory file, relative to the home dir. */
  userMemoryFile: string;
}

/**
 * Claude Code — also the legacy default for payloads that name no event, so
 * every pre-adapter install keeps its exact behaviour (REQ-AGENTADAPT-002.A2).
 */
export const CLAUDE_CODE_TRAITS: HostTraits = {
  id: 'claude',
  displayName: 'Claude Code',
  memoryFile: 'CLAUDE.md',
  configDir: '.claude',
  userConfigFile: '.claude.json',
  transcriptDir: '.claude/projects',
  readTools: ['Read'],
  searchTools: ['Grep', 'Glob'],
  specshipToolMarkers: ['"name":"mcp__specship__'],
  transcriptFormat: 'jsonl',
  supportsBeforeToolDeny: false,
  toolPrefix: 'mcp__specship__',
  fallbackPromptEvent: 'UserPromptSubmit',
  fallbackToolEvent: 'PreToolUse',
  denyEligibleTools: [],
  shellTool: null,
  projectSettingsFile: '.claude/settings.json',
  postEditEvent: 'PostToolUse',
  writeToolMatcher: 'Edit|Write',
  memoryNotesDir: '.claude/memory',
  userMemoryFile: '.claude/CLAUDE.md',
};

/** Gemini CLI (verified against 0.28.0). */
export const GEMINI_CLI_TRAITS: HostTraits = {
  id: 'gemini',
  displayName: 'Gemini CLI',
  memoryFile: 'GEMINI.md',
  configDir: '.gemini',
  userConfigFile: '.gemini/settings.json',
  transcriptDir: '.gemini/tmp',
  readTools: ['read_file', 'read_many_files'],
  searchTools: ['grep_search', 'glob'],
  // Bare names before 0.33.0, `mcp_specship_<tool>` from 0.33.0 (REQ-AGENTSWITCH-018).
  specshipToolMarkers: ['"name":"specship_', '"name": "specship_', '"name":"mcp_specship_', '"name": "mcp_specship_'],
  transcriptFormat: 'single-json',
  supportsBeforeToolDeny: true,
  toolPrefix: '',
  fallbackPromptEvent: 'BeforeAgent',
  fallbackToolEvent: 'BeforeTool',
  denyEligibleTools: ['grep_search', 'glob'],
  shellTool: 'run_shell_command',
  projectSettingsFile: '.gemini/settings.json',
  postEditEvent: 'AfterTool',
  // Same matcher the installer's post-edit sync hook uses (targets/gemini.ts).
  writeToolMatcher: 'write_file|replace',
  memoryNotesDir: null,
  userMemoryFile: '.gemini/GEMINI.md',
};

/**
 * The profile code uses when no host is known (REQ-AGENTSWITCH-001): Claude
 * Code, so every pre-adapter caller keeps its exact output.
 */
export const DEFAULT_HOST_TRAITS: HostTraits = CLAUDE_CODE_TRAITS;

/** Every host profile, in registry order. */
export const ALL_HOST_TRAITS: readonly HostTraits[] = [CLAUDE_CODE_TRAITS, GEMINI_CLI_TRAITS];

/**
 * The profile for an agent id (`claude`, `gemini`); {@link DEFAULT_HOST_TRAITS}
 * for an unknown or missing id, e.g. the detection result `unknown`.
 */
export function hostTraitsFor(id: string | null | undefined): HostTraits {
  return ALL_HOST_TRAITS.find((t) => t.id === id) ?? DEFAULT_HOST_TRAITS;
}

/**
 * The agents a project is set up for (REQ-AGENTSWITCH-003): every host whose
 * root memory file or project config directory exists at `projectRoot`, in
 * registry order. A project carrying neither is treated as Claude Code's, the
 * default host, so pre-adapter projects keep their exact behaviour.
 */
export function agentsInProject(projectRoot: string): HostTraits[] {
  const present = ALL_HOST_TRAITS.filter(
    (t) =>
      fs.existsSync(path.join(projectRoot, t.memoryFile)) ||
      fs.existsSync(path.join(projectRoot, t.configDir)),
  );
  return present.length > 0 ? [...present] : [DEFAULT_HOST_TRAITS];
}

const GEMINI_EVENTS = new Set(['BeforeAgent', 'BeforeTool', 'AfterTool']);

/**
 * How to FORMAT the reply to a hook payload. Falls back to Claude Code traits
 * for payloads naming no (or a shared) event — the backward-compatibility
 * contract of REQ-AGENTADAPT-002.A2. That fallback is a formatting default,
 * not evidence: use {@link detectHookAgent} to ask which agent sent it.
 */
export function deriveHostTraits(payload: HookPayload): HostTraits {
  if (payload.hookEventName && GEMINI_EVENTS.has(payload.hookEventName)) {
    return GEMINI_CLI_TRAITS;
  }
  return DEFAULT_HOST_TRAITS;
}

/**
 * Which agent SENT a hook payload (REQ-AGENTSWITCH-007). Only an event name a
 * single agent sends counts as proof; a shared event such as `SessionStart`,
 * or a payload naming no event, is `unknown` — unlike {@link deriveHostTraits},
 * which still picks a formatting default for those.
 */
export function detectHookAgent(payload: HookPayload): DetectedAgent {
  return agentFromHookEvent(payload.hookEventName);
}
