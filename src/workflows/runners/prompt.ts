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
 * Limitations (acceptable for v1):
 *   - Per-node MCP server config (`nodeConfig.mcp`) is NOT plumbed yet —
 *     prompt nodes inherit whatever MCP servers the host Claude Code session
 *     has configured. v2 candidate.
 *   - Per-node hooks (PreToolUse / PostToolUse) likewise inherit host-level
 *     hooks. v2 will write a per-run settings file.
 *   - Skills / agents passed via flags will need verification on Claude Code
 *     versions that support them.
 *
 * Verbose tool output streams to `<logsDir>/<runId>-<nodeId>.jsonl`.
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { DagNode, PromptNode } from '../schemas/workflow';
import { NodeRunner, NodeRunResult, RunnerContext } from './types';

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

    const claudeBin = process.env.SPECSHIP_CLAUDE_BIN ?? 'claude';
    const args: string[] = [];
    args.push('--print');
    // Output as JSON so we can parse the response cleanly.
    args.push('--output-format', 'json');
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

    // Verbose output streaming.
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
        stdout += chunk.toString();
        logStream?.write(`${JSON.stringify({ event: 'stdout', chunk: chunk.toString(), ts: Date.now() })}\n`);
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

        // Try to parse Claude's JSON output. If it's plain text, treat the
        // whole stdout as the response.
        let text = stdout;
        let structured: Record<string, unknown> | undefined;
        try {
          const parsed = JSON.parse(stdout);
          if (parsed && typeof parsed === 'object') {
            structured = parsed as Record<string, unknown>;
            // Common shapes: { result, ... } or { content: [...] }
            if (typeof structured.result === 'string') {
              text = structured.result;
            } else if (Array.isArray(structured.content)) {
              text = (structured.content as Array<{ text?: string }>)
                .map((c) => c.text ?? '')
                .join('');
            } else {
              text = stdout;
            }
          }
        } catch {
          // Not JSON — keep raw stdout as text.
        }

        resolve({
          status: 'completed',
          output: { text, structured },
        });
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
