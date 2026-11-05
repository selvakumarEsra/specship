/**
 * REQ-AGENTSWITCH-009 — a migration changes only what SpecShip owns
 * (specs/agent-switch.md).
 *
 * Runs against a temp HOME, a temp SPECSHIP_INSTALL_DIR and a temp project P
 * installed and recorded for Claude Code only, with user text in CLAUDE.md
 * and a second, user-owned MCP server in `.mcp.json`. The migration is the
 * real one (`maybeAutoMigrate` with a detected Gemini CLI); uninstall goes
 * through the target exactly as `specship uninstall --target gemini` does.
 *
 * Each acceptance criterion is a NAMED function passed to it(), so the spec's
 * `verifies:` block can point at a symbol.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  readAddedContextFiles,
  recordInstall,
  recordUninstall,
  agentRecordPath,
} from '../src/installer/agent-record';
import { claudeTarget } from '../src/installer/targets/claude';
import { geminiTarget } from '../src/installer/targets/gemini';
import { maybeAutoMigrate } from '../src/installer/auto-migrate';

const ENV_KEYS = [
  'HOME', 'USERPROFILE', 'APPDATA', 'XDG_CONFIG_HOME', 'SPECSHIP_INSTALL_DIR',
  'SPECSHIP_AUTO_MIGRATE', 'GEMINI_CLI', 'CLAUDECODE',
] as const;

let tmpHome: string;
let projectP: string;
let origCwd: string;
let prevEnv: Record<string, string | undefined>;

const USER_CLAUDE_MD = '# My project\n\nUser-owned notes that must never move.\n';

beforeEach(() => {
  tmpHome = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cg-a009-home-')));
  projectP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cg-a009-p-')));
  prevEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;
  process.env.APPDATA = path.join(tmpHome, '.config');
  process.env.XDG_CONFIG_HOME = path.join(tmpHome, '.config');
  process.env.SPECSHIP_INSTALL_DIR = path.join(tmpHome, '.specship');
  delete process.env.SPECSHIP_AUTO_MIGRATE;
  delete process.env.GEMINI_CLI;
  delete process.env.CLAUDECODE;
  origCwd = process.cwd();
  process.chdir(projectP);
  vi.spyOn(process.stdout, 'write').mockImplementation((() => true) as typeof process.stdout.write);
  vi.spyOn(process.stderr, 'write').mockImplementation((() => true) as typeof process.stderr.write);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
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

const geminiSettingsFile = () => path.join(projectP, '.gemini', 'settings.json');
const readGeminiSettings = (): Record<string, any> => JSON.parse(fs.readFileSync(geminiSettingsFile(), 'utf-8'));

/** Write Gemini settings the user authored before any migration. */
function seedGeminiSettings(settings: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(geminiSettingsFile()), { recursive: true });
  fs.writeFileSync(geminiSettingsFile(), JSON.stringify(settings, null, 2) + '\n');
}

/** P installed and recorded for Claude Code only; optional user CLAUDE.md and extra MCP server. */
function seedClaudeOnly(opts: { claudeMd?: boolean; otherServer?: boolean } = {}): void {
  if (opts.claudeMd !== false) fs.writeFileSync(path.join(projectP, 'CLAUDE.md'), USER_CLAUDE_MD);
  if (opts.otherServer) {
    fs.writeFileSync(path.join(projectP, '.mcp.json'), JSON.stringify({
      mcpServers: { other: { type: 'stdio', command: 'other-mcp', args: ['--serve'] } },
    }, null, 2) + '\n');
  }
  claudeTarget.install('local', { autoAllow: true, sdd: opts.claudeMd !== false, installStatusLine: false });
  recordInstall('claude', 'local', projectP, '0.0.0-test', process.env, { autoAllow: true, sdd: true, statusLine: false });
}

/** The real Claude → Gemini migration, as the CLI runs it under Gemini CLI. */
function migrateToGemini(): void {
  const outcome = maybeAutoMigrate('gemini', { projectRoot: projectP });
  expect(outcome.kind).toBe('installed');
}

/** `specship uninstall --target gemini --location local`: target, then record. */
function uninstallGemini(): void {
  geminiTarget.uninstall('local');
  recordUninstall('gemini', 'local', projectP);
}

/** A1 — CLAUDE.md byte-identical; Gemini lists CLAUDE.md alongside GEMINI.md. */
function reqAgentswitch009A1(): void {
  seedClaudeOnly();
  const before = fs.readFileSync(path.join(projectP, 'CLAUDE.md'));
  expect(before.toString()).toContain('User-owned notes');

  migrateToGemini();

  expect(fs.readFileSync(path.join(projectP, 'CLAUDE.md')).equals(before)).toBe(true);
  expect(readGeminiSettings().context.fileName).toEqual(['GEMINI.md', 'CLAUDE.md']);
  // The names we added are SpecShip state in the record, not in Gemini's settings.
  expect(readAddedContextFiles('gemini', 'local', projectP)).toEqual(['GEMINI.md', 'CLAUDE.md']);
  expect(JSON.stringify(readGeminiSettings())).not.toContain("addedContextFiles");

  // Idempotent: a re-run of the install reports the context write unchanged.
  const again = geminiTarget.install('local', { autoAllow: false, installStatusLine: false, sdd: true });
  expect(again.files.find((f) => f.path === geminiSettingsFile())?.action).toBe('unchanged');
  expect(readGeminiSettings().context.fileName).toEqual(['GEMINI.md', 'CLAUDE.md']);
  expect(readAddedContextFiles('gemini', 'local', projectP)).toEqual(['GEMINI.md', 'CLAUDE.md']);
}

/** A2 — a context file name the user already configured is still present. */
function reqAgentswitch009A2(): void {
  // String value → array, user name first.
  seedClaudeOnly();
  seedGeminiSettings({ context: { fileName: 'AGENTS.md', other: true }, ui: { theme: 'dark' } });
  migrateToGemini();
  let s = readGeminiSettings();
  expect(s.context.fileName).toEqual(['AGENTS.md', 'CLAUDE.md']);
  expect(s.context.other).toBe(true);
  expect(s.ui).toEqual({ theme: 'dark' });
  expect(readAddedContextFiles('gemini', 'local', projectP)).toEqual(['CLAUDE.md']);

  // Array value, order kept.
  geminiTarget.uninstall('local');
  recordUninstall('gemini', 'local', projectP);
  seedGeminiSettings({ context: { fileName: ['AGENTS.md', 'NOTES.md'] } });
  geminiTarget.install('local', { autoAllow: false, installStatusLine: false, sdd: true });
  s = readGeminiSettings();
  expect(s.context.fileName).toEqual(['AGENTS.md', 'NOTES.md', 'CLAUDE.md']);

  // A user list that already holds CLAUDE.md is left exactly as it was.
  geminiTarget.uninstall('local');
  recordUninstall('gemini', 'local', projectP);
  seedGeminiSettings({ context: { fileName: ['CLAUDE.md', 'AGENTS.md'] } });
  geminiTarget.install('local', { autoAllow: false, installStatusLine: false, sdd: true });
  expect(readGeminiSettings().context.fileName).toEqual(['CLAUDE.md', 'AGENTS.md']);
  expect(readAddedContextFiles('gemini', 'local', projectP)).toBeNull();

  // Legacy top-level contextFileName is read as the user's list and left alone.
  geminiTarget.uninstall('local');
  seedGeminiSettings({ contextFileName: 'LEGACY.md' });
  geminiTarget.install('local', { autoAllow: false, installStatusLine: false, sdd: true });
  s = readGeminiSettings();
  expect(s.contextFileName).toBe('LEGACY.md');
  expect(s.context.fileName).toEqual(['LEGACY.md', 'CLAUDE.md']);
}

/** A3 — a second MCP server in `.mcp.json` does not appear in Gemini's settings. */
function reqAgentswitch009A3(): void {
  seedClaudeOnly({ otherServer: true });
  const mcp = JSON.parse(fs.readFileSync(path.join(projectP, '.mcp.json'), 'utf-8'));
  expect(Object.keys(mcp.mcpServers).sort()).toEqual(['other', 'specship']);
  const mcpBefore = fs.readFileSync(path.join(projectP, '.mcp.json'));

  migrateToGemini();

  expect(Object.keys(readGeminiSettings().mcpServers)).toEqual(['specship']);
  expect(fs.readFileSync(path.join(projectP, '.mcp.json')).equals(mcpBefore)).toBe(true);
}

/** A4 — uninstall removes the added CLAUDE.md entry and leaves the user's own. */
function reqAgentswitch009A4(): void {
  // User's AGENTS.md stays; our CLAUDE.md goes.
  seedClaudeOnly();
  seedGeminiSettings({ context: { fileName: ['AGENTS.md'] } });
  migrateToGemini();
  uninstallGemini();
  expect(readGeminiSettings().context.fileName).toEqual(['AGENTS.md']);
  expect(fs.readFileSync(path.join(projectP, 'CLAUDE.md'), 'utf-8')).toContain('User-owned notes');

  // A CLAUDE.md the user listed before install survives uninstall.
  seedGeminiSettings({ context: { fileName: ['CLAUDE.md'] } });
  geminiTarget.install('local', { autoAllow: false, installStatusLine: false, sdd: true });
  recordInstall('gemini', 'local', projectP);
  uninstallGemini();
  expect(readGeminiSettings().context.fileName).toEqual(['CLAUDE.md']);

  // No user value: uninstall leaves no `context` key behind.
  fs.rmSync(path.join(projectP, '.gemini'), { recursive: true, force: true });
  geminiTarget.install('local', { autoAllow: false, installStatusLine: false, sdd: true });
  recordInstall('gemini', 'local', projectP);
  expect(readGeminiSettings().context.fileName).toEqual(['GEMINI.md', 'CLAUDE.md']);
  uninstallGemini();
  const after = fs.existsSync(geminiSettingsFile()) ? readGeminiSettings() : {};
  expect(after.context).toBeUndefined();

  // Lost record (rebuilt from configs, no added-names list): uninstall is
  // conservative and leaves context.fileName untouched.
  geminiTarget.install('local', { autoAllow: false, installStatusLine: false, sdd: true });
  fs.rmSync(agentRecordPath(), { force: true });
  geminiTarget.uninstall('local');
  expect(readGeminiSettings().context.fileName).toEqual(['GEMINI.md', 'CLAUDE.md']);
}

/** No CLAUDE.md at the scope → nothing written, nothing recorded. */
function reqAgentswitch009NoClaudeMd(): void {
  seedClaudeOnly({ claudeMd: false });
  expect(fs.existsSync(path.join(projectP, 'CLAUDE.md'))).toBe(false);
  migrateToGemini();
  expect(readGeminiSettings().context).toBeUndefined();
  expect(readAddedContextFiles('gemini', 'local', projectP)).toBeNull();
  expect(fs.existsSync(path.join(projectP, 'CLAUDE.md'))).toBe(false);

  // Global scope: no ~/.claude/CLAUDE.md → nothing written there either.
  geminiTarget.install('global', { autoAllow: false, installStatusLine: false, sdd: false });
  const global = JSON.parse(fs.readFileSync(path.join(tmpHome, '.gemini', 'settings.json'), 'utf-8'));
  expect(global.context).toBeUndefined();
}

describe('REQ-AGENTSWITCH-009 — migration does not rewrite user-owned content', () => {
  it('REQ-AGENTSWITCH-009.A1 CLAUDE.md unchanged; Gemini reads it alongside GEMINI.md', reqAgentswitch009A1);
  it('REQ-AGENTSWITCH-009.A2 user-configured context file names are kept', reqAgentswitch009A2);
  it('REQ-AGENTSWITCH-009.A3 other MCP servers are not copied into Gemini', reqAgentswitch009A3);
  it('REQ-AGENTSWITCH-009.A4 uninstall removes only the added context entries', reqAgentswitch009A4);
  it('REQ-AGENTSWITCH-009 no CLAUDE.md at the scope: nothing written or recorded', reqAgentswitch009NoClaudeMd);
});
