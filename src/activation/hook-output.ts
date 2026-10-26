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
