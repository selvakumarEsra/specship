/**
 * REQ-AGENTSWITCH-008 — a switch to a newly used agent sets SpecShip up for
 * it automatically (specs/agent-switch.md).
 *
 * Runs against a temp HOME, a temp SPECSHIP_INSTALL_DIR and a temp project P
 * that is installed and recorded for Claude Code only. Real files on disk;
 * the failure in A5 is a real one (a file where Gemini's commands directory
 * should be), not a stub.
 *
 * Each acceptance criterion is a NAMED function passed to it(), so the spec's
 * `verifies:` block can point at a symbol.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { spawnSync } from 'child_process';
import { recordInstall, readAgentRecord } from '../src/installer/agent-record';
import { claudeTarget } from '../src/installer/targets/claude';
import {
  beginWriteJournal,
  endWriteJournal,
  rollbackJournal,
  atomicWriteFileSync,
} from '../src/installer/targets/shared';
import {
  maybeAutoMigrate,
  migrationLine,
  migrationScope,
  takePendingMigrationFailure,
  autoMigrateEnabled,
} from '../src/installer/auto-migrate';
import { MCPSession } from '../src/mcp/session';
import type { JsonRpcTransport } from '../src/mcp/transport';
import type { MCPEngine } from '../src/mcp/engine';

/**
 * Counts fs reads/writes while `on` — ESM namespace exports can't be spied
 * on, so the hot-path test counts through a partial mock instead.
 */
const fsCalls = vi.hoisted(() => ({ on: false, reads: 0, exists: 0, stats: 0, writes: 0 }));
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  const count = <F extends (...a: any[]) => any>(key: 'reads' | 'exists' | 'stats' | 'writes', fn: F): F =>
    ((...a: any[]) => { if (fsCalls.on) fsCalls[key]++; return fn(...a); }) as F;
  const mocked = {
    ...actual,
    readFileSync: count('reads', actual.readFileSync),
    existsSync: count('exists', actual.existsSync),
    statSync: count('stats', actual.statSync),
    writeFileSync: count('writes', actual.writeFileSync),
  };
  return { ...mocked, default: mocked };
});

const BIN = path.resolve(__dirname, '../dist/bin/specship.js');
const ENV_KEYS = [
  'HOME', 'USERPROFILE', 'APPDATA', 'XDG_CONFIG_HOME', 'SPECSHIP_INSTALL_DIR',
  'SPECSHIP_AUTO_MIGRATE', 'GEMINI_CLI', 'CLAUDECODE',
] as const;

let tmpHome: string;
let projectP: string;
let installDir: string;
let origCwd: string;
let prevEnv: Record<string, string | undefined>;
let stderr: string[];

beforeEach(() => {
  tmpHome = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cg-automig-home-')));
  projectP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cg-automig-p-')));
  installDir = path.join(tmpHome, '.specship');
  prevEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;
  process.env.APPDATA = path.join(tmpHome, '.config');
  process.env.XDG_CONFIG_HOME = path.join(tmpHome, '.config');
  process.env.SPECSHIP_INSTALL_DIR = installDir;
  delete process.env.SPECSHIP_AUTO_MIGRATE;
  delete process.env.GEMINI_CLI;
  delete process.env.CLAUDECODE;
  origCwd = process.cwd();
  process.chdir(projectP);
  stderr = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((() => true) as typeof process.stdout.write);
  vi.spyOn(process.stderr, 'write').mockImplementation(((s: string | Uint8Array) => {
    stderr.push(String(s));
    return true;
  }) as typeof process.stderr.write);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  seedClaudeOnly();
});

afterEach(() => {
  vi.restoreAllMocks();
  process.chdir(origCwd);
  for (const k of ENV_KEYS) {
    if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k];
  }
  fs.rmSync(tmpHome, { recursive: true, force: true });
  fs.rmSync(projectP, { recursive: true, force: true });
});

/** P installed and recorded for Claude Code only, with user text in CLAUDE.md. */
function seedClaudeOnly(): void {
  fs.writeFileSync(path.join(projectP, 'CLAUDE.md'), '# My project\n\nUser-owned notes.\n');
  claudeTarget.install('local', { autoAllow: true, sdd: true, installStatusLine: false });
  recordInstall('claude', 'local', projectP, '0.0.0-test', process.env, { autoAllow: true, sdd: true, statusLine: false });
}

/** path → sha256 + mtime of every file under `root`. */
function snapshot(root: string): Map<string, { hash: string; mtime: number }> {
  const out = new Map<string, { hash: string; mtime: number }>();
  const walk = (dir: string): void => {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else out.set(p, { hash: crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'), mtime: st.mtimeMs });
    }
  };
  walk(root);
  return out;
}

function claudeFiles(): Map<string, string> {
  const out = new Map<string, string>();
  for (const [p, v] of snapshot(projectP)) {
    const rel = path.relative(projectP, p);
    if (rel === '.mcp.json' || rel === 'CLAUDE.md' || rel.startsWith('.claude' + path.sep)) out.set(rel, v.hash);
  }
  return out;
}

function geminiFiles(): string[] {
  return [...snapshot(projectP).keys()]
    .map((p) => path.relative(projectP, p))
    .filter((rel) => rel === 'GEMINI.md' || rel.startsWith('.gemini' + path.sep));
}

/** In-memory transport + engine whose one tool answers "ok". */
function fakeSession() {
  let handler: ((m: any) => Promise<void> | void) | null = null;
  const results: any[] = [];
  const t: JsonRpcTransport = {
    start: (h) => { handler = h as any; },
    stop: () => {},
    send: () => {},
    notify: () => {},
    request: async () => ({}),
    sendResult: (_id, r) => { results.push(r); },
    sendError: () => {},
  };
  const engine = {
    getToolHandler: () => ({
      addTierChangeListener: () => () => {},
      execute: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
    }),
    ensureInitialized: async () => {},
    hasDefaultSpecShip: () => true,
    getProjectPath: () => projectP,
  } as unknown as MCPEngine;
  const session = new MCPSession(t, engine);
  session.start();
  const deliver = async (m: unknown) => { await handler!(m); };
  return {
    results,
    async initialize(clientName: string) {
      await deliver({
        jsonrpc: '2.0', id: 0, method: 'initialize',
        params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: clientName, version: '0.28.0' } },
      });
    },
    async callTool(): Promise<string> {
      await deliver({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'specship_status', arguments: {} } });
      return results[results.length - 1].content[0].text as string;
    },
    stop: () => session.stop(),
  };
}

function migrationStderr(): string[] {
  return stderr.join('').split('\n').filter((l) => l.includes('SpecShip:'));
}

/** A1 — a Gemini MCP session on a Claude-only project installs Gemini locally, one line. */
async function reqAgentswitch008A1(): Promise<void> {
  const s = fakeSession();
  await s.initialize('gemini-cli-mcp-client');
  // Handshake reply is unchanged and comes first.
  expect(s.results).toHaveLength(1);
  expect(s.results[0].serverInfo.name).toBe('specship');

  expect(fs.existsSync(path.join(projectP, '.gemini', 'settings.json'))).toBe(true);
  const settings = JSON.parse(fs.readFileSync(path.join(projectP, '.gemini', 'settings.json'), 'utf-8'));
  expect(settings.mcpServers.specship).toBeTruthy();
  expect(fs.existsSync(path.join(projectP, 'GEMINI.md'))).toBe(true);

  // Exactly one line on stderr, naming the files and the undo command.
  const lines = migrationStderr();
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain('specship uninstall --target gemini --local');
  expect(lines[0]).toContain('.gemini/settings.json');
  expect(lines[0]).toContain('GEMINI.md');
  expect(lines[0]).not.toContain('.claude');

  // …and the same one line prefixes the first tool response, only that one.
  const first = await s.callTool();
  expect(first.split('\n')[0]).toBe(lines[0]!.replace(/^\[SpecShip MCP\] /, ''));
  expect(first).toContain('ok');
  expect(await s.callTool()).toBe('ok');
  s.stop();

  const record = readAgentRecord();
  expect(record!.entries.map((e) => `${e.agent}:${e.scope}`).sort()).toEqual(['claude:local', 'gemini:local']);
}

/** A2 — Claude Code's files are byte-for-byte unchanged by the migration. */
async function reqAgentswitch008A2(): Promise<void> {
  const before = claudeFiles();
  expect(before.has('.mcp.json')).toBe(true);
  expect(before.has('CLAUDE.md')).toBe(true);
  expect([...before.keys()].some((k) => k.startsWith('.claude'))).toBe(true);
  const homeBefore = snapshot(tmpHome);

  const s = fakeSession();
  await s.initialize('gemini-cli-mcp-client');
  s.stop();
  expect(geminiFiles().length).toBeGreaterThan(0);

  expect(claudeFiles()).toEqual(before);
  // Nothing outside the SpecShip home changed under HOME either (no ~/.claude*).
  for (const [p, v] of homeBefore) {
    if (p.startsWith(installDir)) continue;
    expect(snapshot(tmpHome).get(p)).toEqual(v);
  }
}

/** A3 — a second Gemini session writes nothing and prints nothing. */
async function reqAgentswitch008A3(): Promise<void> {
  const s1 = fakeSession();
  await s1.initialize('gemini-cli-mcp-client');
  s1.stop();
  const projectBefore = snapshot(projectP);
  const homeBefore = snapshot(tmpHome);
  stderr.length = 0;

  const s2 = fakeSession();
  await s2.initialize('gemini-cli-mcp-client');
  expect(await s2.callTool()).toBe('ok');
  s2.stop();

  expect(migrationStderr()).toEqual([]);
  expect(snapshot(projectP)).toEqual(projectBefore);
  expect(snapshot(tmpHome)).toEqual(homeBefore);
  expect(maybeAutoMigrate('gemini', { projectRoot: projectP })).toEqual({ kind: 'none' });
}

/** A4 — opted out: nothing written, one hint naming `specship install --target gemini`. */
async function reqAgentswitch008A4(): Promise<void> {
  process.env.SPECSHIP_AUTO_MIGRATE = '0';
  const s = fakeSession();
  await s.initialize('gemini-cli-mcp-client');
  const lines = migrationStderr();
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain('specship install --target gemini');
  expect((await s.callTool()).split('\n')[0]).toContain('specship install --target gemini');
  s.stop();
  expect(geminiFiles()).toEqual([]);
  expect(readAgentRecord()!.entries.map((e) => e.agent)).toEqual(['claude']);

  // The hint is shown once, too.
  stderr.length = 0;
  const s2 = fakeSession();
  await s2.initialize('gemini-cli-mcp-client');
  s2.stop();
  expect(migrationStderr()).toEqual([]);
}

/** A4 (config) — `"autoMigrate": false` in specship.config.json opts out the same way. */
async function reqAgentswitch008A4Config(): Promise<void> {
  fs.writeFileSync(path.join(projectP, 'specship.config.json'), JSON.stringify({ autoMigrate: false }));
  expect(autoMigrateEnabled({}, projectP)).toBe(false);
  const out = maybeAutoMigrate('gemini', { projectRoot: projectP });
  expect(out.kind).toBe('hint');
  expect(out.line).toContain('specship install --target gemini');
  expect(geminiFiles()).toEqual([]);
}

/** A5 — one Gemini file failing rolls the attempt back; the next output reports it. */
async function reqAgentswitch008A5(): Promise<void> {
  // A user GEMINI.md that the attempt will append to, and a FILE where Gemini's
  // commands directory must go — writing the first command then fails for real.
  const userGemini = '# Gemini notes\n\nMine.\n';
  fs.writeFileSync(path.join(projectP, 'GEMINI.md'), userGemini);
  fs.mkdirSync(path.join(projectP, '.gemini'));
  fs.writeFileSync(path.join(projectP, '.gemini', 'commands'), 'not a dir');
  const claudeBefore = claudeFiles();

  const s = fakeSession();
  await s.initialize('gemini-cli-mcp-client');

  // Rolled back: settings.json (written before the failure) is gone, the
  // user's GEMINI.md is byte-identical, the blocker file is untouched.
  expect(fs.existsSync(path.join(projectP, '.gemini', 'settings.json'))).toBe(false);
  expect(fs.readFileSync(path.join(projectP, 'GEMINI.md'), 'utf-8')).toBe(userGemini);
  expect(fs.readFileSync(path.join(projectP, '.gemini', 'commands'), 'utf-8')).toBe('not a dir');
  expect(claudeFiles()).toEqual(claudeBefore);
  expect(readAgentRecord()!.entries.map((e) => e.agent)).toEqual(['claude']);

  // The next SpecShip output (the first tool response) reports the failure, once.
  const first = await s.callTool();
  expect(first.split('\n')[0]).toMatch(/automatic setup for Gemini CLI failed/);
  expect(await s.callTool()).toBe('ok');
  s.stop();
  expect(takePendingMigrationFailure()).toBeNull();
}

/** A5 (pending) — a failure nobody showed yet is reported by the next output, then never again. */
function reqAgentswitch008A5Pending(): void {
  fs.mkdirSync(path.join(projectP, '.gemini'));
  fs.writeFileSync(path.join(projectP, '.gemini', 'commands'), 'not a dir');
  const failed = maybeAutoMigrate('gemini', { projectRoot: projectP });
  expect(failed.kind).toBe('failed');
  // Not delivered → a later call still surfaces it…
  const later = maybeAutoMigrate('gemini', { projectRoot: projectP });
  expect(later.kind).toBe('failed');
  expect(migrationLine(later)).toBe(failed.line);
  // …and once shown, it is gone; no retry happens.
  expect(maybeAutoMigrate('gemini', { projectRoot: projectP })).toEqual({ kind: 'none' });
  expect(fs.existsSync(path.join(projectP, '.gemini', 'settings.json'))).toBe(false);
}

/** The journal restores earlier bytes, deletes new files and drops new empty dirs. */
function journalRollsBackWrites(): void {
  const existing = path.join(projectP, 'keep.txt');
  fs.writeFileSync(existing, 'before');
  beginWriteJournal();
  atomicWriteFileSync(existing, 'after');
  atomicWriteFileSync(path.join(projectP, 'new', 'deep', 'file.txt'), 'x');
  const entries = endWriteJournal();
  rollbackJournal(entries);
  expect(fs.readFileSync(existing, 'utf-8')).toBe('before');
  expect(fs.existsSync(path.join(projectP, 'new'))).toBe(false);
  // No journal open → writes are not recorded.
  atomicWriteFileSync(path.join(projectP, 'plain.txt'), 'y');
  expect(endWriteJournal()).toEqual([]);
}

/** Hot path: unknown agent touches no file; a recorded agent costs one read, no write. */
function hotPathCost(): void {
  Object.assign(fsCalls, { on: true, reads: 0, exists: 0, stats: 0, writes: 0 });
  try {
    expect(maybeAutoMigrate('unknown', { projectRoot: projectP })).toEqual({ kind: 'none' });
    expect(maybeAutoMigrate('cursor', { projectRoot: projectP })).toEqual({ kind: 'none' });
    expect({ ...fsCalls }).toEqual({ on: true, reads: 0, exists: 0, stats: 0, writes: 0 });

    expect(maybeAutoMigrate('claude', { projectRoot: projectP })).toEqual({ kind: 'none' });
    expect(fsCalls.reads).toBe(1);
    expect(fsCalls.exists + fsCalls.stats + fsCalls.writes).toBe(0);
  } finally {
    fsCalls.on = false;
  }
}

/** Scope follows the existing install: enclosing local entry first, then global, else nothing. */
function scopeFollowsExistingInstall(): void {
  const record = readAgentRecord();
  expect(migrationScope(record, path.join(projectP, 'src', 'deep'))).toEqual({ scope: 'local', projectRoot: projectP });
  expect(migrationScope(record, tmpHome)).toBeNull();
  expect(migrationScope({ schemaVersion: 1, entries: [{ agent: 'claude', scope: 'global', version: '1', recordedAt: 'x' }] }, tmpHome))
    .toEqual({ scope: 'global' });
  expect(migrationScope(null, projectP)).toBeNull();
}

/** CLI detection point: a `specship` command in Gemini's shell migrates; the printed undo command works. */
function cliTriggerAndUndo(): void {
  const env = { ...process.env, GEMINI_CLI: '1' };
  delete (env as Record<string, string | undefined>).CLAUDECODE;
  const run = spawnSync(process.execPath, [BIN, 'status'], { cwd: projectP, env, encoding: 'utf-8' });
  const line = run.stderr.split('\n').find((l) => l.includes('SpecShip: set up Gemini CLI'));
  expect(line, run.stderr).toBeTruthy();
  expect(line).toContain('specship uninstall --target gemini --local');
  expect(fs.existsSync(path.join(projectP, '.gemini', 'settings.json'))).toBe(true);
  const claudeBefore = claudeFiles();

  const undo = spawnSync(process.execPath, [BIN, 'uninstall', '--target', 'gemini', '--local'], {
    cwd: projectP, env: { ...env, GEMINI_CLI: '' }, encoding: 'utf-8',
  });
  expect(undo.status, undo.stderr + undo.stdout).toBe(0);
  expect(fs.existsSync(path.join(projectP, '.gemini', 'settings.json'))
    && JSON.parse(fs.readFileSync(path.join(projectP, '.gemini', 'settings.json'), 'utf-8')).mcpServers?.specship).toBeFalsy();
  expect(claudeFiles()).toEqual(claudeBefore);
  expect(fs.existsSync(BIN)).toBe(true); // wiring-only: the binary and data stay
  expect(fs.existsSync(installDir)).toBe(true);
}

describe('REQ-AGENTSWITCH-008 — auto-migrate to a newly detected agent', () => {
  it('REQ-AGENTSWITCH-008.A1: a Gemini MCP session installs Gemini for the project and prints one line', reqAgentswitch008A1);
  it('REQ-AGENTSWITCH-008.A2: Claude Code files are byte-for-byte unchanged', reqAgentswitch008A2);
  it('REQ-AGENTSWITCH-008.A3: a second Gemini session writes and prints nothing', reqAgentswitch008A3);
  it('REQ-AGENTSWITCH-008.A4: SPECSHIP_AUTO_MIGRATE=0 writes nothing and hints once', reqAgentswitch008A4);
  it('REQ-AGENTSWITCH-008.A4: "autoMigrate": false in specship.config.json opts out', reqAgentswitch008A4Config);
  it('REQ-AGENTSWITCH-008.A5: a failed write rolls the attempt back and the next output reports it', reqAgentswitch008A5);
  it('REQ-AGENTSWITCH-008.A5: an undelivered failure is reported by the next output, once', reqAgentswitch008A5Pending);
  it('write journal rolls back writes, new files and new directories', journalRollsBackWrites);
  it('hot path: unknown agent reads nothing; recorded agent costs one read', hotPathCost);
  it('migration scope follows the existing install', scopeFollowsExistingInstall);
  it.runIf(fs.existsSync(BIN))('CLI detection point migrates and the printed undo command works', cliTriggerAndUndo);
});
