/**
 * Install handshake smoke check (INSTALL-HANDSHAKE-DOC).
 *
 * Proves an install can actually serve queries, so a broken runtime / missing
 * FTS5 / unbootable MCP server / unreadable index surfaces at install time
 * (advisory — REQ-HANDSHAKE-002.A4) and via `specship doctor` (gating —
 * REQ-HANDSHAKE-003).
 *
 * The environment-dependent probes are injectable so the aggregation logic is
 * unit-testable without spawning a real server; the default probes do the real
 * work.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import { createDatabase } from '../db/sqlite-adapter';
import { isInitialized } from '../directory';

export type SmokeCheckId = 'runtime' | 'fts5' | 'mcp-boot' | 'index';

export interface SmokeCheckItem {
  id: SmokeCheckId;
  label: string;
  ok: boolean;
  /** A failure of a blocking item makes the install unusable → `doctor` exits non-zero. */
  blocking: boolean;
  detail: string;
  /** Shown only when `ok` is false. */
  remediation?: string;
}

export interface SmokeCheckResult {
  items: SmokeCheckItem[];
  ok: boolean;
  blockingFailures: SmokeCheckItem[];
}

/** Each probe returns its raw verdict; `runSmokeCheck` shapes them into items. */
export interface SmokeProbes {
  backend: () => { ok: boolean; detail: string };
  fts5: () => { ok: boolean; detail: string };
  mcpBoot: () => boolean | Promise<boolean>;
  indexQueryable: () =>
    | { ok: boolean; detail: string; applicable: boolean }
    | Promise<{ ok: boolean; detail: string; applicable: boolean }>;
}

const FTS5_REMEDIATION =
  'Use the published bundle (node 24 with FTS5) or, when running from source, ' +
  '`npm install --save-dev better-sqlite3` so FTS5 works on a host Node built without it.';

/** Open a throwaway SQLite db, hand it to `fn`, then clean up the file + WAL/SHM. */
function withTempDb<T>(fn: (db: ReturnType<typeof createDatabase>) => T): T {
  const tmp = path.join(os.tmpdir(), `specship-smoke-${process.pid}-${process.hrtime.bigint()}.db`);
  let created: ReturnType<typeof createDatabase> | undefined;
  try {
    created = createDatabase(tmp);
    return fn(created);
  } finally {
    try {
      created?.db.close();
    } catch {
      /* best effort */
    }
    for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) {
      try {
        fs.rmSync(f, { force: true });
      } catch {
        /* best effort */
      }
    }
  }
}

/** The SQLite backend resolves and opens. */
export function probeBackend(): { ok: boolean; detail: string } {
  try {
    return withTempDb(({ backend }) => ({ ok: true, detail: backend }));
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? (e.message.split('\n')[0] ?? e.message) : String(e) };
  }
}

/** FTS5 actually works — the check that catches an FTS5-less host Node. */
export function probeFts5(): { ok: boolean; detail: string } {
  try {
    return withTempDb(({ db, backend }) => {
      db.exec('CREATE VIRTUAL TABLE smoke_fts USING fts5(x)');
      db.exec('DROP TABLE smoke_fts');
      return { ok: true, detail: `available (${backend})` };
    });
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? (e.message.split('\n')[0] ?? e.message) : String(e) };
  }
}

/**
 * The MCP server boots: spawn `serve --mcp`, send an `initialize` request, and
 * accept any JSON-RPC response within the timeout. Bounded and best-effort — it
 * always resolves (never hangs the caller).
 */
export async function probeMcpBoot(opts?: { binPath?: string; timeoutMs?: number }): Promise<boolean> {
  const bin = opts?.binPath ?? path.join(__dirname, '..', 'bin', 'specship.js');
  if (!fs.existsSync(bin)) return false;
  return await new Promise<boolean>((resolve) => {
    let settled = false;
    const child = spawn(process.execPath, ['--liftoff-only', bin, 'serve', '--mcp'], {
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    const finish = (v: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.kill('SIGKILL');
      } catch {
        /* best effort */
      }
      resolve(v);
    };
    const timer = setTimeout(() => finish(false), opts?.timeoutMs ?? 6000);
    let buf = '';
    child.stdout.on('data', (d) => {
      buf += d.toString();
      if (buf.includes('"jsonrpc"') || buf.includes('"serverInfo"') || buf.includes('"result"')) {
        finish(true);
      }
    });
    child.on('error', () => finish(false));
    child.on('exit', () => finish(false));
    const init =
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'specship-smoke', version: '0' },
        },
      }) + '\n';
    try {
      child.stdin.write(init);
    } catch {
      finish(false);
    }
  });
}

/** A trivial query against the project index returns (when the project is indexed). */
export async function probeIndexQueryable(
  projectRoot: string
): Promise<{ ok: boolean; detail: string; applicable: boolean }> {
  if (!isInitialized(projectRoot)) {
    return { ok: true, applicable: false, detail: 'no project index (run `specship init -i` to create one)' };
  }
  try {
    const { SpecShip } = await import('../index');
    const cg = await SpecShip.open(projectRoot);
    try {
      cg.searchNodes('a', { limit: 1 });
      return { ok: true, applicable: true, detail: 'queryable' };
    } finally {
      cg.destroy();
    }
  } catch (e) {
    return { ok: false, applicable: true, detail: e instanceof Error ? (e.message.split('\n')[0] ?? e.message) : String(e) };
  }
}

function defaultProbes(projectRoot: string): SmokeProbes {
  return {
    backend: probeBackend,
    fts5: probeFts5,
    mcpBoot: () => probeMcpBoot(),
    indexQueryable: () => probeIndexQueryable(projectRoot),
  };
}

/**
 * Run the smoke check. Probes can be partially overridden (tests inject
 * deterministic verdicts); anything not overridden uses the real probe.
 */
export async function runSmokeCheck(opts?: {
  projectRoot?: string;
  probes?: Partial<SmokeProbes>;
}): Promise<SmokeCheckResult> {
  const projectRoot = opts?.projectRoot ?? process.cwd();
  const p = { ...defaultProbes(projectRoot), ...opts?.probes };

  const backend = p.backend();
  const fts = p.fts5();
  const boot = await p.mcpBoot();
  const index = await p.indexQueryable();

  const items: SmokeCheckItem[] = [
    {
      id: 'runtime',
      label: 'SQLite runtime',
      ok: backend.ok,
      blocking: true,
      detail: backend.detail,
      remediation: backend.ok ? undefined : 'SpecShip could not open a SQLite backend on this runtime.',
    },
    {
      id: 'fts5',
      label: 'Full-text search (FTS5)',
      ok: fts.ok,
      blocking: true,
      detail: fts.detail,
      remediation: fts.ok ? undefined : FTS5_REMEDIATION,
    },
    {
      id: 'mcp-boot',
      label: 'MCP server boots',
      ok: boot,
      blocking: true,
      detail: boot ? 'starts and answers an initialize request' : 'did not respond to an initialize request',
      remediation: boot ? undefined : 'After installing, restart Claude Code (or run `/mcp`) so the server is loaded.',
    },
    {
      id: 'index',
      label: 'Project index queryable',
      ok: index.ok,
      // Only an *applicable* index (the project is indexed) is usage-blocking;
      // an un-indexed project is a no-op, not a failure.
      blocking: index.applicable,
      detail: index.detail,
      remediation: index.ok ? undefined : 'Re-build the index with `specship index`.',
    },
  ];

  const blockingFailures = items.filter((i) => !i.ok && i.blocking);
  return { items, ok: items.every((i) => i.ok), blockingFailures };
}

/** Exit code for `specship doctor`: non-zero iff a usage-blocking check failed. */
export function doctorExitCode(result: SmokeCheckResult): number {
  return result.blockingFailures.length > 0 ? 1 : 0;
}
