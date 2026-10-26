/**
 * Gemini CLI headless adapter (REQ-AGENTADAPT-007), against the installed
 * 0.28.0 source (DOM-SPECSHIP-008): piped stdin runs Gemini headless, and in
 * that mode every approval-needing tool not in `--allowed-tools` is removed,
 * so each step's tools are translated to Gemini's names. There is no deny or
 * append-system-prompt flag: `denied_tools` is refused, and the appended
 * system prompt leads the stdin prompt.
 */

import { EmitFn, HeadlessAgent, HeadlessInvocation, StreamParseState, parseJsonLine, summarizeToolInput } from './types';

/** Claude-form built-in tool names → Gemini CLI 0.28 tool names. */
const BUILTIN_TOOLS: Record<string, string> = {
  Read: 'read_file',
  Write: 'write_file',
  Edit: 'replace',
  MultiEdit: 'replace',
  Bash: 'run_shell_command',
  Glob: 'glob',
  Grep: 'grep_search',
  LS: 'list_directory',
  WebFetch: 'web_fetch',
  WebSearch: 'google_web_search',
};
const MODEL_TIERS = new Set(['haiku', 'sonnet', 'opus']);

/** Translate a step's allowed tools, or name the first one with no Gemini equivalent. */
export function translateGeminiTools(tools: string[]): { tools: string[] } | { error: string } {
  const out: string[] = [];
  for (const tool of tools) {
    let mapped: string | undefined;
    const mcp = tool.match(/^mcp__([A-Za-z0-9_-]+?)__(.+)$/);
    const shell = tool.match(/^Bash\((.+?)(?::\*)?\)$/);
    if (mcp) mapped = `${mcp[1]}__${mcp[2]}`;
    else if (shell) mapped = `run_shell_command(${shell[1]!.trim()})`;
    else mapped = BUILTIN_TOOLS[tool];
    if (!mapped) return { error: `allowed tool "${tool}" has no Gemini CLI equivalent` };
    if (!out.includes(mapped)) out.push(mapped);
  }
  return { tools: out };
}

/** The Gemini model for a step: a mapped tier alias, a Gemini id as-is, else none (Gemini's default). */
export function geminiModelFor(model: string | undefined, models: Record<string, string> | undefined): string | undefined {
  if (!model) return undefined;
  if (MODEL_TIERS.has(model)) return models?.[model];
  return /^gemini/i.test(model) ? model : undefined; // a Claude id is never passed to Gemini
}

/** Parse one Gemini stream-json event (init / message / tool_use / error / result). */
export function handleGeminiStreamLine(line: string, emit: EmitFn, state: StreamParseState): void {
  const e = parseJsonLine(line);
  if (!e) return;
  switch (e.type) {
    case 'init':
      state.sawStream = true;
      if (typeof e.model === 'string' && e.model) state.model = e.model;
      break;
    case 'message':
      state.sawStream = true;
      if (e.role === 'assistant' && typeof e.content === 'string' && e.content) {
        // Deltas are fragments of one turn; whole messages are separate turns.
        state.assistantText += e.delta === true || !state.assistantText ? e.content : `\n${e.content}`;
        emit('agent_message', { text: e.content });
      }
      break;
    case 'tool_use':
      state.sawStream = true;
      emit('tool_called', { name: e.tool_name, input: summarizeToolInput(e.parameters) });
      break;
    case 'result': {
      state.sawStream = true;
      const stats = e.stats as Record<string, unknown> | undefined;
      if (stats && typeof stats.duration_ms === 'number') state.durationMs = stats.duration_ms;
      if (e.status === 'error') {
        const err = e.error as Record<string, unknown> | undefined;
        state.failure = typeof err?.message === 'string' ? err.message : 'Gemini CLI reported an error result';
      }
      break;
    }
    case 'error':
      state.sawStream = true;
      if (e.severity === 'error' && typeof e.message === 'string') state.failure = e.message;
      break;
  }
}

export const geminiHeadlessAgent: HeadlessAgent = {
  id: 'gemini',
  // Gemini CLI sets GEMINI_CLI=1 for the shell commands it runs.
  launchedFrom: (env) => env.GEMINI_CLI === '1',
  build(node, config, env): HeadlessInvocation | { error: string } {
    if (node.denied_tools && node.denied_tools.length > 0) {
      return { error: `denied_tools (${node.denied_tools.join(', ')}) cannot be enforced on Gemini CLI — it has no deny flag` };
    }
    const args = ['--output-format', 'stream-json'];
    const model = geminiModelFor(node.model, config.models);
    if (model) args.push('--model', model);
    if (node.allowed_tools && node.allowed_tools.length > 0) {
      const t = translateGeminiTools(node.allowed_tools);
      if ('error' in t) return t;
      args.push('--allowed-tools', ...t.tools);
    }
    const stdin = node.systemPromptAppend
      ? `${node.systemPromptAppend.trimEnd()}\n\n---\n\n${node.prompt}`
      : node.prompt;
    return { bin: env.SPECSHIP_GEMINI_BIN ?? 'gemini', args, stdin };
  },
  handleLine: handleGeminiStreamLine,
};
