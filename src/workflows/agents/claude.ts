/**
 * Claude Code headless adapter (REQ-AGENTADAPT-005): `claude --print` with
 * stream-json output. The argument list is exactly what the prompt runner
 * built before adapters existed (REQ-AGENTADAPT-005.A1).
 */

import type { PromptNode } from '../schemas/workflow';
import { EmitFn, HeadlessAgent, HeadlessInvocation, StreamParseState, parseJsonLine, summarizeToolInput } from './types';

export function buildClaudeArgs(node: PromptNode): string[] {
  const args: string[] = [];
  args.push('--print');
  // Stream the agent's activity as JSONL so we can surface tool calls and
  // messages live. `--print` + `--output-format stream-json` requires
  // `--verbose` (the CLI rejects the combination otherwise).
  args.push('--output-format', 'stream-json', '--verbose');
  if (node.model) args.push('--model', node.model);
  if (node.allowed_tools && node.allowed_tools.length > 0) {
    args.push('--allowed-tools', node.allowed_tools.join(','));
  }
  if (node.denied_tools && node.denied_tools.length > 0) {
    args.push('--disallowed-tools', node.denied_tools.join(','));
  }
  if (node.systemPromptAppend) {
    args.push('--append-system-prompt', node.systemPromptAppend);
  }
  return args;
}

/**
 * Parse one stream-json line, emit any activity events, and fold the result
 * into `state`. Pure aside from the `emit` callback. Unknown / non-JSON lines
 * are ignored. Extended-thinking blocks are intentionally NOT emitted.
 */
export function handleClaudeStreamLine(line: string, emit: EmitFn, state: StreamParseState): void {
  const e = parseJsonLine(line);
  if (!e) return;

  if (e.type === 'assistant' && e.message && typeof e.message === 'object') {
    state.sawStream = true;
    const content = (e.message as Record<string, unknown>).content;
    if (Array.isArray(content)) {
      for (const raw of content) {
        const b = raw as Record<string, unknown>;
        if (b?.type === 'tool_use') {
          emit('tool_called', { name: b.name, input: summarizeToolInput(b.input) });
        } else if (b?.type === 'text' && typeof b.text === 'string' && b.text.trim()) {
          state.assistantText += (state.assistantText ? '\n' : '') + b.text;
          emit('agent_message', { text: b.text });
        }
        // 'thinking' blocks: deliberately skipped.
      }
    }
  } else if (e.type === 'result') {
    state.sawStream = true;
    if (typeof e.result === 'string') state.resultText = e.result;
    if (typeof e.total_cost_usd === 'number') state.costUsd = e.total_cost_usd;
    if (typeof e.duration_ms === 'number') state.durationMs = e.duration_ms;
  } else if (e.type === 'system') {
    state.sawStream = true; // init/system frame — confirms we're on the stream path
    if (typeof e.model === 'string' && e.model) state.model = e.model;
  }
}

export const claudeHeadlessAgent: HeadlessAgent = {
  id: 'claude',
  // Claude Code sets CLAUDECODE=1 in the environment of the commands it runs.
  launchedFrom: (env) => env.CLAUDECODE === '1',
  build(node, _config, env): HeadlessInvocation {
    return { bin: env.SPECSHIP_CLAUDE_BIN ?? 'claude', args: buildClaudeArgs(node), stdin: node.prompt };
  },
  handleLine: handleClaudeStreamLine,
};
