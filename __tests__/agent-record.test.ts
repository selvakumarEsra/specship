/**
 * REQ-AGENTSWITCH-006 — the installed-agents record (specs/agent-switch.md).
 *
 * Runs against a temp HOME, a temp SPECSHIP_INSTALL_DIR and a temp project P,
 * the same pattern installer-targets.test.ts uses. Real files on disk; only
 * the shimmer progress bar is stubbed (its worker needs a compiled sibling).
 *
 * Each acceptance criterion is a NAMED function passed to it(), so the spec's
 * `verifies:` block can point at a symbol.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  agentRecordPath,
  ensureAgentRecord,
  readAgentRecord,
  rebuildAgentRecord,
  recordInstall,
  writeAgentRecord,
} from '../src/installer/agent-record';
import { runInstallerWithOptions, uninstallTargets, reinstallRecordedAgents } from '../src/installer';
import { claudeTarget } from '../src/installer/targets/claude';
import { geminiTarget } from '../src/installer/targets/gemini';
import { runUpdate } from '../src/update/updater';

vi.mock('../src/ui/shimmer-progress', () => ({
  createShimmerProgress: () => ({ onProgress: () => {}, stop: async () => {} }),
}));

const ENV_KEYS = ['HOME', 'USERPROFILE', 'APPDATA', 'XDG_CONFIG_HOME', 'SPECSHIP_INSTALL_DIR', 'GEMINI_API_KEY'] as const;

let tmpHome: string;
let projectP: string;
let installDir: string;
let origCwd: string;
let prevEnv: Record<string, string | undefined>;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-agentrec-home-'));
  projectP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cg-agentrec-p-')));
  installDir = path.join(tmpHome, '.specship');
  prevEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;
  process.env.APPDATA = path.join(tmpHome, '.config');
  process.env.XDG_CONFIG_HOME = path.join(tmpHome, '.config');
  process.env.SPECSHIP_INSTALL_DIR = installDir;
  origCwd = process.cwd();
  process.chdir(projectP);
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

function silence(): void {
  vi.spyOn(process.stdout, 'write').mockImplementation((() => true) as typeof process.stdout.write);
  vi.spyOn(process.stderr, 'write').mockImplementation((() => true) as typeof process.stderr.write);
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

/** A1 — install Gemini locally in P → recorded for P; uninstall → gone. */
async function reqAgentswitch006A1(): Promise<void> {
  silence();
  const clack = await import('@clack/prompts');
  await runInstallerWithOptions(
    { target: 'gemini', location: 'local', yes: true, skipIndex: true },
    { clack },
  );
  vi.restoreAllMocks();

  const afterInstall = readAgentRecord();
  expect(afterInstall).not.toBeNull();
  const gemini = afterInstall!.entries.filter((e) => e.agent === 'gemini');
  expect(gemini).toHaveLength(1);
  expect(gemini[0].scope).toBe('local');
  expect(gemini[0].projectRoot).toBe(projectP);
  expect(typeof gemini[0].version).toBe('string');
  expect(Number.isNaN(Date.parse(gemini[0].recordedAt))).toBe(false);

  // `specship uninstall --target gemini` (wiring sweep) clears the entry.
  const reports = uninstallTargets([geminiTarget], 'local');
  expect(reports[0].status).toBe('removed');
  expect(readAgentRecord()!.entries.some((e) => e.agent === 'gemini')).toBe(false);
}

/** A2 — a deleted or unreadable record is rebuilt from the agents' configs. */
function reqAgentswitch006A2(): void {
  // Gemini wired user-wide, Claude wired into P — each carries a SpecShip MCP entry.
  writeJson(path.join(tmpHome, '.gemini', 'settings.json'), {
    mcpServers: { specship: { command: 'specship', args: ['serve', '--mcp'] } },
  });
  writeJson(path.join(projectP, '.mcp.json'), {
    mcpServers: { specship: { type: 'stdio', command: 'specship', args: ['serve', '--mcp'] } },
  });
  // A config WITHOUT a SpecShip entry is not recorded.
  writeJson(path.join(projectP, '.gemini', 'settings.json'), { mcpServers: { other: { command: 'x' } } });

  const file = agentRecordPath();
  expect(fs.existsSync(file)).toBe(false);

  const rebuilt = ensureAgentRecord(projectP);
  const keys = rebuilt.entries.map((e) => `${e.agent}:${e.scope}`).sort();
  expect(keys).toEqual(['claude:local', 'gemini:global']);
  expect(rebuilt.entries.find((e) => e.agent === 'claude')!.projectRoot).toBe(projectP);
  expect(rebuilt.entries.find((e) => e.agent === 'gemini')!.projectRoot).toBeUndefined();
  expect(readAgentRecord()).toEqual(rebuilt);

  // Unreadable → rebuilt the same way.
  fs.writeFileSync(file, '{ not json');
  expect(readAgentRecord()).toBeNull();
  expect(ensureAgentRecord(projectP).entries.map((e) => `${e.agent}:${e.scope}`).sort())
    .toEqual(['claude:local', 'gemini:global']);

  // A present record is neither re-detected nor rewritten (read-only commands
  // must not touch the SpecShip home on every invocation).
  const before = fs.readFileSync(file, 'utf-8');
  const mtime = fs.statSync(file).mtimeMs;
  const detect = vi.spyOn(geminiTarget, 'detect');
  ensureAgentRecord(projectP);
  expect(detect).not.toHaveBeenCalled();
  expect(fs.readFileSync(file, 'utf-8')).toBe(before);
  expect(fs.statSync(file).mtimeMs).toBe(mtime);
  // Writing identical contents is a no-op too.
  expect(writeAgentRecord(readAgentRecord()!)).toBe(false);
}

/** A3 — `specship update` on a machine recorded for both agents reinstalls both. */
async function reqAgentswitch006A3(): Promise<void> {
  recordInstall('claude', 'global', undefined, '0.1.0');
  recordInstall('gemini', 'local', projectP, '0.1.0');

  const claudeInstall = vi.spyOn(claudeTarget, 'install');
  const geminiInstall = vi.spyOn(geminiTarget, 'install');

  // Run from elsewhere: the local entry must be reinstalled in ITS project.
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-agentrec-else-'));
  process.chdir(elsewhere);
  try {
    let binaryUpdated = 0;
    const result = await runUpdate({
      currentVersion: '0.1.0',
      detect: () => 'npm',
      resolveLatest: async () => '0.2.0',
      runInstaller: async () => { binaryUpdated++; },
      reinstallAgents: async () => reinstallRecordedAgents().map((r) => r.detail),
      installDir,
      binDir: path.join(tmpHome, '.local', 'bin'),
    });

    expect(result.exitCode).toBe(0);
    expect(binaryUpdated).toBe(1);
    expect(claudeInstall).toHaveBeenCalledTimes(1);
    expect(claudeInstall.mock.calls[0][0]).toBe('global');
    expect(geminiInstall).toHaveBeenCalledTimes(1);
    expect(geminiInstall.mock.calls[0][0]).toBe('local');
    expect(fs.existsSync(path.join(projectP, '.gemini', 'settings.json'))).toBe(true);
    expect(fs.existsSync(path.join(elsewhere, '.gemini'))).toBe(false);
    expect(result.lines.join('\n')).toMatch(/Claude Code \(global\): reinstalled/);
    expect(result.lines.join('\n')).toMatch(/Gemini CLI .*: reinstalled/);
    expect(process.cwd()).toBe(fs.realpathSync(elsewhere));
  } finally {
    process.chdir(projectP);
    fs.rmSync(elsewhere, { recursive: true, force: true });
  }

  // A failing reinstall is a warning, not a failed update.
  const failed = await runUpdate({
    currentVersion: '0.1.0',
    detect: () => 'npm',
    resolveLatest: async () => '0.2.0',
    runInstaller: async () => {},
    reinstallAgents: async () => { throw new Error('boom'); },
    installDir,
    binDir: path.join(tmpHome, '.local', 'bin'),
  });
  expect(failed.exitCode).toBe(0);
  expect(failed.lines.join('\n')).toMatch(/Warning: could not reinstall.*boom/);
}

/** A4 — the record holds no tokens, keys or environment values. */
async function reqAgentswitch006A4(): Promise<void> {
  const SECRET_KEY = 'AIza-secret-gemini-key-123';
  const SECRET_TOKEN = 'jira-token-secret-456';
  process.env.GEMINI_API_KEY = SECRET_KEY;
  writeJson(path.join(tmpHome, '.gemini', 'settings.json'), {
    mcpServers: {
      specship: {
        command: 'specship',
        args: ['serve', '--mcp'],
        env: { SPECSHIP_INTEGRATIONS: 'jira', JIRA_API_TOKEN: SECRET_TOKEN, GEMINI_API_KEY: SECRET_KEY },
      },
    },
  });

  ensureAgentRecord(projectP);
  silence();
  const clack = await import('@clack/prompts');
  await runInstallerWithOptions({ target: 'gemini', location: 'local', yes: true, skipIndex: true }, { clack });
  vi.restoreAllMocks();

  // A tampered file carrying extra fields loses them on the next write.
  const file = agentRecordPath();
  const tampered = JSON.parse(fs.readFileSync(file, 'utf-8'));
  tampered.entries[0].token = SECRET_TOKEN;
  tampered.entries[0].env = { GEMINI_API_KEY: SECRET_KEY };
  fs.writeFileSync(file, JSON.stringify(tampered));
  recordInstall('claude', 'global', undefined);

  const raw = fs.readFileSync(file, 'utf-8');
  expect(raw).not.toContain(SECRET_KEY);
  expect(raw).not.toContain(SECRET_TOKEN);
  expect(raw).not.toMatch(/"env"|SPECSHIP_INTEGRATIONS|JIRA_|API_KEY|token/i);

  const parsed = JSON.parse(raw);
  expect(Object.keys(parsed).sort()).toEqual(['entries', 'schemaVersion']);
  const allowed = new Set(['agent', 'scope', 'projectRoot', 'version', 'recordedAt']);
  expect(parsed.entries.length).toBeGreaterThanOrEqual(2);
  for (const entry of parsed.entries) {
    for (const key of Object.keys(entry)) expect(allowed.has(key)).toBe(true);
  }
  // Rebuild-from-config output is whitelisted the same way.
  for (const entry of rebuildAgentRecord(projectP).entries) {
    for (const key of Object.keys(entry)) expect(allowed.has(key)).toBe(true);
  }
}

describe('REQ-AGENTSWITCH-006 — installed-agents record', () => {
  it('REQ-AGENTSWITCH-006.A1: install --target gemini --local records Gemini for P; uninstall removes it', reqAgentswitch006A1);
  it('REQ-AGENTSWITCH-006.A2: a deleted or unreadable record is rebuilt from agent configs with a SpecShip MCP entry', reqAgentswitch006A2);
  it('REQ-AGENTSWITCH-006.A3: specship update reinstalls every recorded agent', reqAgentswitch006A3);
  it('REQ-AGENTSWITCH-006.A4: the record contains no tokens, keys or environment values', reqAgentswitch006A4);
});
