/**
 * PromptNode runner — invokes Claude Code in headless mode.
 *
 * Why shell out instead of embedding the Claude Agent SDK:
 *   - This fork is Claude-Code-only; users have `claude` on PATH already.
 *   - The SDK pulls in real auth complexity + ~MB of deps. The CLI's
 *     headless `--print` mode is purpose-built for non-interactive use.
 *   - Per-node `allowed_tools` / `denied_tools` / `model` map cleanly to
 *     CLI flags.
 *
 * The agent runs with `--output-format stream-json`, so its activity streams
 * out line-by-line. Each line is parsed and surfaced as a workflow event via
 * `ctx.emitEvent` (WF-STREAM-DOC): a `tool_called` event per tool the agent
 * invokes (name + short input) and an `agent_message` event per assistant text
 * turn. The step's text output is the stream's terminal `result` — identical to
 * what the old `--output-format json` produced. If the output isn't a parseable
 * stream, we fall back to treating stdout as the result, so a run never breaks.
 *
 * Limitations (acceptable for v1):
 *   - Per-node MCP server config is NOT plumbed — prompt nodes inherit the host
 *     Claude Code session's MCP servers. v2 candidate.
 *   - Per-node hooks likewise inherit host-level hooks.
 *
 * Raw output also streams to `<logsDir>/<runId>-<nodeId>.jsonl`.
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { DagNode, PromptNode } from '../schemas/workflow';
import { NodeRunner, NodeRunResult, RunnerContext } from './types';
import { WorkflowEventType } from '../../types';

const TRANSIENT_PATTERNS = [
  /rate.?limit/i,
  /timeout/i,
  /network/i,
  /connection.?reset/i,
  /econn/i,
  /etimedout/i,
];

/** Accumulated state while parsing the agent's stream-json output. */
export interface StreamParseState {
  /** True once at least one line parsed as a known stream event. */
  sawStream: boolean;
  /** Final result text from the terminal `result` event, if seen. */
  resultText: string | null;
  /** Concatenated assistant text turns (fallback when there's no result event). */
  assistantText: string;
  /** `total_cost_usd` from the terminal `result` frame, if present. */
  costUsd?: number;
  /** `duration_ms` from the terminal `result` frame, if present. */
  durationMs?: number;
  /** `model` from the `system` init frame, if present. */
  model?: string;
}

export function newStreamState(): StreamParseState {
  return { sawStream: false, resultText: null, assistantText: '' };
}

/** A short, single-line summary of a tool's input for the `tool_called` event. */
export function summarizeToolInput(input: unknown): string {
  if (input == null) return '';
  let s: string;
  if (typeof input === 'string') {
    s = input;
  } else if (typeof input === 'object') {
    const o = input as Record<string, unknown>;
    const pick =
      o.file_path ?? o.path ?? o.command ?? o.pattern ?? o.query ?? o.url ?? o.prompt;
    s = typeof pick === 'string' ? pick : JSON.stringify(o);
  } else {
    s = String(input);
  }
  s = s.replace(/\s+/g, ' ').trim();
  return s.length > 140 ? `${s.slice(0, 140)}…` : s;
}

/**
 * Parse one stream-json line, emit any activity events, and fold the result
 * into `state`. Pure aside from the `emit` callback. Unknown / non-JSON lines
 * are ignored. Extended-thinking blocks are intentionally NOT emitted.
 */
export function handleStreamLine(
  line: string,
  emit: (type: WorkflowEventType, data?: Record<string, unknown>) => void,
  state: StreamParseState,
): void {
  const trimmed = line.trim();
  if (!trimmed) return;
  let ev: unknown;
  try {
    ev = JSON.parse(trimmed);
  } catch {
    return; // not JSON — ignore (keeps the fallback path intact)
  }
  if (!ev || typeof ev !== 'object') return;
  const e = ev as Record<string, unknown>;

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

export class PromptRunner implements NodeRunner {
  readonly kind = 'prompt' as const;

  async run(rawNode: DagNode, ctx: RunnerContext): Promise<NodeRunResult> {
    if (rawNode.kind !== 'prompt') {
      return { status: 'failed', error: `PromptRunner received ${rawNode.kind} node` };
    }
    const node = rawNode as PromptNode;

    const claudeBin = process.env.SPECSHIP_CLAUDE_BIN ?? 'claude';
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

    const logPath = path.join(ctx.logsDir, `${ctx.runId}-${node.id}.jsonl`);

    return new Promise<NodeRunResult>((resolve) => {
      let child;
      try {
        child = spawn(claudeBin, args, {
          cwd: ctx.cwd,
          env: process.env,
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        });
      } catch (err) {
        resolve({
          status: 'failed',
          error: `failed to spawn ${claudeBin}: ${err instanceof Error ? err.message : String(err)}`,
        });
        return;
      }

      let stdout = '';
      let stderr = '';
      let lineBuf = '';
      const state = newStreamState();
      let logStream: fs.WriteStream | null = null;
      try {
        logStream = fs.createWriteStream(logPath, { flags: 'a' });
        logStream.write(
          `${JSON.stringify({ event: 'spawn', cwd: ctx.cwd, args, ts: Date.now() })}\n`
        );
      } catch {
        logStream = null;
      }

      child.stdout?.on('data', (chunk: Buffer) => {
        const s = chunk.toString();
        stdout += s;
        logStream?.write(`${JSON.stringify({ event: 'stdout', chunk: s, ts: Date.now() })}\n`);
        // Parse complete lines as they arrive; emit events live.
        lineBuf += s;
        let idx;
        while ((idx = lineBuf.indexOf('\n')) !== -1) {
          const line = lineBuf.slice(0, idx);
          lineBuf = lineBuf.slice(idx + 1);
          if (ctx.emitEvent) handleStreamLine(line, ctx.emitEvent, state);
        }
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
        logStream?.write(`${JSON.stringify({ event: 'stderr', chunk: chunk.toString(), ts: Date.now() })}\n`);
      });

      const timeoutMs = node.idle_timeout ?? 0;
      const killer = timeoutMs > 0
        ? setTimeout(() => {
            try { child!.kill('SIGTERM'); } catch { /* ignore */ }
          }, timeoutMs)
        : null;

      child.on('error', (err) => {
        if (killer) clearTimeout(killer);
        logStream?.end();
        resolve({
          status: 'failed',
          error: `spawn error: ${err.message}`,
          transient: isTransient(err.message),
        });
      });

      child.on('close', (code) => {
        if (killer) clearTimeout(killer);
        // Flush any trailing partial line.
        if (lineBuf.trim() && ctx.emitEvent) handleStreamLine(lineBuf, ctx.emitEvent, state);
        logStream?.end();

        if (code !== 0) {
          const errMsg = (stderr || stdout || '').slice(0, 4000);
          resolve({
            status: 'failed',
            error: `claude exited with code ${code}: ${errMsg}`,
            transient: isTransient(errMsg),
          });
          return;
        }

        // Stream path: the terminal `result` is the node's output — identical
        // to what `--output-format json` produced.
        if (state.sawStream) {
          const text = state.resultText ?? state.assistantText ?? stdout;
          const stats =
            state.costUsd !== undefined || state.durationMs !== undefined || state.model !== undefined
              ? { costUsd: state.costUsd, durationMs: state.durationMs, model: state.model }
              : undefined;
          resolve({
            status: 'completed',
            output: { text, structured: state.resultText !== null ? { result: state.resultText } : undefined },
            stats,
          });
          return;
        }

        // Fallback: output wasn't a parseable stream (e.g. a single JSON blob or
        // plain text). Preserve the pre-stream behavior so a run never breaks.
        let text = stdout;
        let structured: Record<string, unknown> | undefined;
        try {
          const parsed = JSON.parse(stdout);
          if (parsed && typeof parsed === 'object') {
            structured = parsed as Record<string, unknown>;
            if (typeof structured.result === 'string') {
              text = structured.result;
            } else if (Array.isArray(structured.content)) {
              text = (structured.content as Array<{ text?: string }>).map((c) => c.text ?? '').join('');
            } else {
              text = stdout;
            }
          }
        } catch {
          // Not JSON — keep raw stdout as text.
        }
        resolve({ status: 'completed', output: { text, structured } });
      });

      // Send the prompt on stdin.
      try {
        child.stdin?.write(node.prompt);
        child.stdin?.end();
      } catch (err) {
        if (killer) clearTimeout(killer);
        logStream?.end();
        resolve({
          status: 'failed',
          error: `stdin write failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    });
  }
}

function isTransient(msg: string): boolean {
  return TRANSIENT_PATTERNS.some((p) => p.test(msg));
}
