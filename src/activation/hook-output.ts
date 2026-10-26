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
 * Host-shaped traits derived from a hook payload — the one place that peeks
 * at `hook_event_name` to decide whether we're serving Claude Code or Gemini
 * CLI. Shared code (`search-intercept`, `bin/specship`) consumes the traits
 * and never event-name-sniffs itself, keeping it host-agnostic per the
 * project's agent-agnostic rule.
 *
 *   - `specshipToolMarkers` — substrings naming a specship tool_use record.
 *     Claude exposes our server as `mcp__specship__<tool>`; Gemini shows
 *     the model the bare tool name (`specship_explore`), qualifying it as
 *     `specship__<tool>` only on a name collision.
 *   - `transcriptFormat` — Claude writes JSONL (one record per line); Gemini's
 *     `ChatRecordingService` writes one pretty-printed JSON doc with
 *     `messages[].toolCalls[].name`.
 *   - `supportsBeforeToolDeny` — whether the host reads a top-level
 *     `{decision:'deny'}` on its BeforeTool-equivalent. Gemini 0.28.0+
 *     `BeforeToolHookOutput.isBlockingDecision` does; Claude's PreToolUse
 *     uses a different shape so we never emit deny for Claude.
 */
export interface HostTraits {
  specshipToolMarkers: string[];
  transcriptFormat: 'jsonl' | 'single-json';
  supportsBeforeToolDeny: boolean;
}

const GEMINI_EVENTS = new Set(['BeforeAgent', 'BeforeTool', 'AfterTool']);

export function deriveHostTraits(payload: HookPayload): HostTraits {
  if (payload.hookEventName && GEMINI_EVENTS.has(payload.hookEventName)) {
    return {
      specshipToolMarkers: ['"name":"specship_', '"name": "specship_'],
      transcriptFormat: 'single-json',
      supportsBeforeToolDeny: true,
    };
  }
  return {
    specshipToolMarkers: ['"name":"mcp__specship__'],
    transcriptFormat: 'jsonl',
    supportsBeforeToolDeny: false,
  };
}
