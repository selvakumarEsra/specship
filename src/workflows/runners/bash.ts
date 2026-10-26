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
/** How much of a failed step's output the one-line `error` keeps. */
const ERROR_TAIL_CHARS = 4000;

/**
 * Keep the LAST `max` chars — test runners and compilers print their summary
 * at the end, so the head is the least useful part (REQ-PIPETRUST-006.A1).
 */
export function tailForError(text: string, max = ERROR_TAIL_CHARS): string {
  return text.length > max ? `…${text.slice(text.length - max)}` : text;
}

/** Combined output of a failed step, stdout first then stderr. */
function combinedOutput(stdout: string, stderr: string): string {
  if (stdout && stderr) return `${stdout}${stdout.endsWith('\n') ? '' : '\n'}${stderr}`;
  return stdout || stderr;
}

/**
 * The SpecShip CLI running this process — `{ node, script }` when this
 * process is the CLI, else null. Exported to bash steps as
 * SPECSHIP_CLI_NODE / SPECSHIP_CLI_SCRIPT (kept separate so paths with spaces
 * survive) plus a display-only SPECSHIP_CLI.
 */
export function specshipCli(
  argv: string[] = process.argv,
  execPath: string = process.execPath,
): { node: string; script: string } | null {
  const script = argv[1] ?? '';
  if (!/^specship(\.js)?$/.test(path.basename(script))) return null;
  return { node: execPath, script };
}

function cliEnv(): Record<string, string> {
  const cli = specshipCli();
  if (!cli) return {};
  return {
    SPECSHIP_CLI_NODE: cli.node,
    SPECSHIP_CLI_SCRIPT: cli.script,
    SPECSHIP_CLI: `${cli.node} ${cli.script}`,
  };
}

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
      // The exact CLI running this workflow (PIPETRUST-DOC, REQ-PIPETRUST-006.A4):
      // steps call `$SPECSHIP_CLI` before any `specship` on PATH, so a step
      // never runs an older globally installed CLI that lacks its command.
      ...cliEnv(),
      // Where this run keeps its artifacts, so a step can leave durable
      // evidence (e.g. a JSON test report) beside the node outputs.
      SPECSHIP_ARTIFACTS_DIR: ctx.artifactsDir,
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
        const combined = combinedOutput(stdout, stderr);
        if (signal === 'SIGTERM') {
          resolve({
            status: 'failed',
            error: `bash node timed out after ${timeout}ms`,
            transient: true,
            ...(combined ? { output: { text: combined } } : {}),
          });
          return;
        }
        const errMsg = tailForError(stderr || stdout || '');
        resolve({
          status: 'failed',
          error: `bash exited with code ${code}: ${errMsg}`,
          output: { text: combined },
        });
      });
    });
  }
}
