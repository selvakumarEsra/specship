/**
 * PromptNode runner — runs a step on a coding agent in headless mode.
 *
 * Host-neutral (REQ-AGENTADAPT-005): the run's headless-agent adapter
 * (`src/workflows/agents/`) supplies the binary, translates the step's model,
 * tools and appended system prompt into that host's flags, and parses its
 * streamed output. Shelling out to the agent's CLI (rather than embedding an
 * SDK) keeps auth with the user's own install and adds no dependencies.
 *
 * Each streamed line is surfaced as a workflow event via `ctx.emitEvent`
 * (WF-STREAM-DOC): a `tool_called` event per tool the agent invokes and an
 * `agent_message` event per assistant text turn. The step's text output is the
 * host's final result (or its concatenated assistant text). If the output isn't
 * a parseable stream, stdout is treated as the result, so a run never breaks.
 *
 * Limitations (acceptable for v1):
 *   - Per-node MCP server config is NOT plumbed — prompt nodes inherit the
 *     host agent's configured MCP servers. v2 candidate.
 *   - Per-node hooks likewise inherit host-level hooks.
 *
 * Raw output also streams to `<logsDir>/<runId>-<nodeId>.jsonl`.
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { DagNode, PromptNode } from '../schemas/workflow';
import { NodeRunner, NodeRunResult, RunnerContext } from './types';
import { DEFAULT_WORKFLOW_AGENT, getHeadlessAgent, workflowAgentConfig } from '../agents';
import { newStreamState } from '../agents/types';

// Kept as this module's exports so existing importers keep working.
export { newStreamState, summarizeToolInput } from '../agents/types';
export type { StreamParseState } from '../agents/types';
export { handleClaudeStreamLine as handleStreamLine } from '../agents/claude';

const TRANSIENT_PATTERNS = [
  /rate.?limit/i,
  /timeout/i,
  /network/i,
  /connection.?reset/i,
  /econn/i,
  /etimedout/i,
];

export class PromptRunner implements NodeRunner {
  readonly kind = 'prompt' as const;

  async run(rawNode: DagNode, ctx: RunnerContext): Promise<NodeRunResult> {
    if (rawNode.kind !== 'prompt') {
      return { status: 'failed', error: `PromptRunner received ${rawNode.kind} node` };
    }
    const node = rawNode as PromptNode;

    // The run's agent (REQ-AGENTADAPT-006) translates the step; shared code
    // never names a host binary or flag (REQ-AGENTADAPT-005).
    const agentId = ctx.agent ?? DEFAULT_WORKFLOW_AGENT;
    const agent = getHeadlessAgent(agentId);
    if (!agent) return { status: 'failed', error: `unknown workflow agent "${agentId}"` };
    const built = agent.build(node, workflowAgentConfig(ctx.cwd, agent.id), process.env);
    if ('error' in built) {
      return { status: 'failed', error: `${agent.id} cannot run step ${node.id}: ${built.error}` };
    }
    const { bin, args } = built;
    const binName = path.basename(bin);

    const logPath = path.join(ctx.logsDir, `${ctx.runId}-${node.id}.jsonl`);

    return new Promise<NodeRunResult>((resolve) => {
      let child;
      try {
        child = spawn(bin, args, {
          cwd: ctx.cwd,
          env: process.env,
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        });
      } catch (err) {
        resolve({
          status: 'failed',
          error: `failed to spawn ${bin}: ${err instanceof Error ? err.message : String(err)}`,
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
        // The log is best-effort: an unwritable logs dir must never crash the run.
        logStream.on('error', () => {});
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
          if (ctx.emitEvent) agent.handleLine(line, ctx.emitEvent, state);
          else agent.handleLine(line, () => {}, state);
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
        // A missing binary is a setup problem, not a transient one (REQ-AGENTADAPT-006.A5).
        const missing = (err as NodeJS.ErrnoException).code === 'ENOENT';
        resolve({
          status: 'failed',
          error: missing
            ? `${binName} not found on PATH — install ${agent.id === DEFAULT_WORKFLOW_AGENT ? 'it' : `the ${agent.id} CLI`} or choose another agent with --agent`
            : `spawn error: ${err.message}`,
          transient: missing ? false : isTransient(err.message),
        });
      });

      child.on('close', (code) => {
        if (killer) clearTimeout(killer);
        // Flush any trailing partial line.
        if (lineBuf.trim()) agent.handleLine(lineBuf, ctx.emitEvent ?? (() => {}), state);
        logStream?.end();

        if (code !== 0) {
          const errMsg = (stderr || stdout || '').slice(0, 4000);
          resolve({
            status: 'failed',
            error: `${binName} exited with code ${code}: ${errMsg}`,
            transient: isTransient(errMsg),
          });
          return;
        }

        // Stream path: the terminal `result` is the node's output — identical
        // to what `--output-format json` produced.
        if (state.failure) {
          resolve({ status: 'failed', error: `${binName} reported an error: ${state.failure}`, transient: isTransient(state.failure) });
          return;
        }
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
        child.stdin?.write(built.stdin);
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
