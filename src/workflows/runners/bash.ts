/**
 * BashNode runner — executes a shell command and captures stdout/stderr.
 *
 * Default shell: `/bin/bash -c` on POSIX, `cmd.exe /c` on Windows.
 * Non-zero exit code → node failure.
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { DagNode, BashNode } from '../schemas/workflow';
import { NodeRunner, NodeRunResult, RunnerContext } from './types';

const DEFAULT_TIMEOUT_MS = 60_000;

export class BashRunner implements NodeRunner {
  readonly kind = 'bash' as const;

  async run(rawNode: DagNode, ctx: RunnerContext): Promise<NodeRunResult> {
    if (rawNode.kind !== 'bash') {
      return { status: 'failed', error: `BashRunner received ${rawNode.kind} node` };
    }
    const node = rawNode as BashNode;
    const cwd = node.cwd ?? ctx.cwd;
    const timeout = node.timeout ?? DEFAULT_TIMEOUT_MS;
    // Put the runtime SpecShip itself runs on at the FRONT of PATH so `node`
    // (and everything npm scripts spawn) resolves to it — not to whatever the
    // host shell defaults to. A host Node without FTS5 / with a mismatched
    // better-sqlite3 ABI was one of the documented verify-leg false-fail
    // classes (WF-REJECT-DOC, REQ-WFREJ-005).
    const runtimeDir = path.dirname(process.execPath);
    const basePath = process.env.PATH ?? '';
    const env = {
      ...process.env,
      // Always prepend — being merely *present* later in PATH still loses to
      // an earlier host Node.
      PATH: `${runtimeDir}${path.delimiter}${basePath}`,
      ...(node.env ?? {}),
    };

    const isWindows = process.platform === 'win32';
    const shell = isWindows ? 'cmd.exe' : '/bin/bash';
    const shellArgs = isWindows ? ['/c', node.bash] : ['-c', node.bash];

    const logPath = path.join(ctx.logsDir, `${ctx.runId}-${node.id}.bash.log`);

    return new Promise<NodeRunResult>((resolve) => {
      let child;
      try {
        child = spawn(shell, shellArgs, {
          cwd,
          env,
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        });
      } catch (err) {
        resolve({
          status: 'failed',
          error: `failed to spawn shell: ${err instanceof Error ? err.message : String(err)}`,
        });
        return;
      }

      let stdout = '';
      let stderr = '';
      const logStream = (() => {
        try {
          return fs.createWriteStream(logPath, { flags: 'a' });
        } catch {
          return null;
        }
      })();
      logStream?.write(`# bash node ${node.id} started at ${new Date().toISOString()}\n`);
      logStream?.write(`# cwd: ${cwd}\n`);
      logStream?.write(`# command: ${node.bash}\n\n`);

      child.stdout?.on('data', (chunk: Buffer) => {
        const s = chunk.toString();
        stdout += s;
        logStream?.write(s);
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        const s = chunk.toString();
        stderr += s;
        logStream?.write(`[stderr] ${s}`);
      });

      const killer = setTimeout(() => {
        try { child.kill('SIGTERM'); } catch { /* ignore */ }
      }, timeout);

      child.on('error', (err) => {
        clearTimeout(killer);
        logStream?.end();
        resolve({
          status: 'failed',
          error: `spawn error: ${err.message}`,
        });
      });

      child.on('close', (code, signal) => {
        clearTimeout(killer);
        logStream?.end();

        if (code === 0) {
          resolve({
            status: 'completed',
            output: { text: stdout },
          });
          return;
        }
        if (signal === 'SIGTERM') {
          resolve({
            status: 'failed',
            error: `bash node timed out after ${timeout}ms`,
            transient: true,
          });
          return;
        }
        const errMsg = (stderr || stdout || '').slice(0, 4000);
        resolve({
          status: 'failed',
          error: `bash exited with code ${code}: ${errMsg}`,
        });
      });
    });
  }
}
