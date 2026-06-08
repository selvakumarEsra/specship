/**
 * ScriptNode runner — executes a TypeScript/Python script via `bun` or `uv`.
 *
 * The script source is written to a temp file under
 * `<artifactsDir>/scripts/<nodeId>.{ts,py}` and invoked by the chosen runtime.
 * Optional `deps` are installed first (`bun install <pkg>` / `uv add <pkg>`).
 *
 * The runtime binary is resolved from `SPECSHIP_BUN_BIN` / `SPECSHIP_UV_BIN`
 * env vars if set, else `bun` / `uv` on PATH.
 */

import { spawn, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { DagNode, ScriptNode } from '../schemas/workflow';
import { NodeRunner, NodeRunResult, RunnerContext } from './types';

const DEFAULT_TIMEOUT_MS = 120_000;

export class ScriptRunner implements NodeRunner {
  readonly kind = 'script' as const;

  async run(rawNode: DagNode, ctx: RunnerContext): Promise<NodeRunResult> {
    if (rawNode.kind !== 'script') {
      return { status: 'failed', error: `ScriptRunner received ${rawNode.kind} node` };
    }
    const node = rawNode as ScriptNode;
    const cwd = node.cwd ?? ctx.cwd;
    const timeout = node.timeout ?? DEFAULT_TIMEOUT_MS;
    const env = { ...process.env, ...(node.env ?? {}) };

    const bin =
      node.runtime === 'bun'
        ? process.env.SPECSHIP_BUN_BIN ?? 'bun'
        : process.env.SPECSHIP_UV_BIN ?? 'uv';

    // Sanity-check the runtime exists before writing the script.
    const which = spawnSync(bin, ['--version'], { encoding: 'utf-8', windowsHide: true });
    if (which.status !== 0) {
      return {
        status: 'failed',
        error: `${node.runtime} runtime not available (${bin} --version exited ${which.status})`,
      };
    }

    // Write the script.
    const ext = node.runtime === 'bun' ? 'ts' : 'py';
    const scriptDir = path.join(ctx.artifactsDir, '..', 'scripts');
    try { fs.mkdirSync(scriptDir, { recursive: true }); } catch { /* ignore */ }
    const scriptPath = path.join(scriptDir, `${sanitizeFilename(node.id)}.${ext}`);
    try {
      fs.writeFileSync(scriptPath, node.script);
    } catch (err) {
      return {
        status: 'failed',
        error: `failed to write script: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // Install deps if declared.
    if (node.deps && node.deps.length > 0) {
      const installArgs = node.runtime === 'bun'
        ? ['install', '--cwd', cwd, ...node.deps]
        : ['add', ...node.deps];
      const install = spawnSync(bin, installArgs, {
        cwd,
        env,
        encoding: 'utf-8',
        windowsHide: true,
      });
      if (install.status !== 0) {
        return {
          status: 'failed',
          error: `dependency install failed: ${install.stderr?.slice(0, 2000) ?? 'unknown'}`,
        };
      }
    }

    const runArgs = node.runtime === 'bun' ? ['run', scriptPath] : ['run', scriptPath];

    return new Promise<NodeRunResult>((resolve) => {
      const child = spawn(bin, runArgs, {
        cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });

      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (c: Buffer) => { stdout += c.toString(); });
      child.stderr?.on('data', (c: Buffer) => { stderr += c.toString(); });

      const killer = setTimeout(() => {
        try { child.kill('SIGTERM'); } catch { /* ignore */ }
      }, timeout);

      child.on('error', (err) => {
        clearTimeout(killer);
        resolve({ status: 'failed', error: `spawn error: ${err.message}` });
      });

      child.on('close', (code, signal) => {
        clearTimeout(killer);
        if (code === 0) {
          resolve({ status: 'completed', output: { text: stdout } });
          return;
        }
        if (signal === 'SIGTERM') {
          resolve({
            status: 'failed',
            error: `script node timed out after ${timeout}ms`,
            transient: true,
          });
          return;
        }
        resolve({
          status: 'failed',
          error: `script exited with code ${code}: ${(stderr || stdout).slice(0, 4000)}`,
        });
      });
    });
  }
}

function sanitizeFilename(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, '-').substring(0, 80);
}
