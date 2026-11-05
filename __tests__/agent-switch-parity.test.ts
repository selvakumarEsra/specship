/**
 * REQ-AGENTSWITCH-010 — a Gemini CLI install gives the same SpecShip
 * experience as a Claude Code install made with the same options
 * (specs/agent-switch.md). Also REQ-AGENTSWITCH-002.A3: the GEMINI.md SDD
 * block names only what the Gemini install provides.
 *
 * Temp HOME / CWD / SPECSHIP_INSTALL_DIR; the Gemini version probe is pinned
 * to 0.28.0 through `SPECSHIP_GEMINI_VERSION`. Real files on disk.
 *
 * Each criterion is a NAMED function passed to it(), so the spec's
 * `verifies:` block can point at a symbol.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { CLAUDE_ARTIFACT_KINDS, claudeTarget } from '../src/installer/targets/claude';
import { GEMINI_MIN_SKILLS, geminiCommandsDir, geminiSkillsDir, geminiTarget } from '../src/installer/targets/gemini';
import { GEMINI_PARITY, noSurfaceNotes } from '../src/installer/targets/feature-parity';
import { recordInstall } from '../src/installer/agent-record';
import { maybeAutoMigrate } from '../src/installer/auto-migrate';
import {
  SPECSHIP_SDD_SECTION_END,
  SPECSHIP_SDD_SECTION_START,
  getSddRuleBlock,
} from '../src/installer/instructions-template';

const BIN = path.resolve(__dirname, '../dist/bin/specship.js');
const ENV_KEYS = [
  'HOME', 'USERPROFILE', 'APPDATA', 'XDG_CONFIG_HOME', 'SPECSHIP_INSTALL_DIR',
  'SPECSHIP_AUTO_MIGRATE', 'SPECSHIP_GEMINI_VERSION',
] as const;

let tmpHome: string;
let tmpCwd: string;
let origCwd: string;
let prevEnv: Record<string, string | undefined>;

beforeEach(() => {
  tmpHome = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'parity-home-')));
  tmpCwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'parity-cwd-')));
  prevEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;
  process.env.APPDATA = path.join(tmpHome, '.config');
  process.env.XDG_CONFIG_HOME = path.join(tmpHome, '.config');
  process.env.SPECSHIP_INSTALL_DIR = path.join(tmpHome, '.specship');
  process.env.SPECSHIP_GEMINI_VERSION = GEMINI_MIN_SKILLS;
  delete process.env.SPECSHIP_AUTO_MIGRATE;
  origCwd = process.cwd();
  process.chdir(tmpCwd);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  process.chdir(origCwd);
  for (const k of ENV_KEYS) {
    if (prevEnv[k] === undefined) delete process.env[k];
    else process.env[k] = prevEnv[k];
  }
  fs.rmSync(tmpHome, { recursive: true, force: true });
  fs.rmSync(tmpCwd, { recursive: true, force: true });
});

const geminiPolicyFile = (): string => path.join(tmpHome, '.gemini', 'policies', 'specship.toml');

/** `/specship:*` names present in a commands dir (`<dir>/specship/<name>.<ext>`). */
function commandNames(commandsDir: string, ext: string): string[] {
  const dir = path.join(commandsDir, 'specship');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(ext)).map((f) => f.slice(0, -ext.length)).sort();
}

/** A1 — every Claude artifact kind has a Gemini surface or a recorded no-surface reason. */
function reqAgentswitch010A1(): void {
  for (const kind of CLAUDE_ARTIFACT_KINDS) {
    const entry = GEMINI_PARITY[kind];
    expect(entry, `${kind} has no GEMINI_PARITY entry`).toBeTruthy();
    expect(entry.surface.trim(), `${kind} names its surface`).not.toBe('');
    const target = 'gemini' in entry ? entry.gemini : entry.noSurface;
    expect(target.trim(), `${kind} has neither a Gemini mapping nor a no-surface reason`).not.toBe('');
  }
  // No stale entries for kinds the Claude target no longer installs.
  expect(Object.keys(GEMINI_PARITY).sort()).toEqual([...CLAUDE_ARTIFACT_KINDS].sort());

  // Every no-surface reason and every limited-surface caveat reaches the install output.
  const notes = geminiTarget.install('local', { autoAllow: true, sdd: true, installStatusLine: true }).notes ?? [];
  for (const line of noSurfaceNotes()) expect(notes).toContain(line);
  for (const entry of Object.values(GEMINI_PARITY)) {
    if (!('gemini' in entry) || !entry.limited) continue;
    const setting = /\b\w+\.\w+\b/.exec(entry.limited)?.[0];
    expect(setting, `limited caveat for ${entry.surface} names the setting to change`).toBeTruthy();
    expect(notes.join('\n')).toContain(setting!);
  }
}

/** A2 — for each `--sdd` × `--with-jira` × `--with-designer`, Gemini's command set equals Claude's. */
function reqAgentswitch010A2(): void {
  const bools = [false, true];
  for (const sdd of bools) for (const withJira of bools) for (const withDesigner of bools) {
    const combo = `sdd=${sdd} jira=${withJira} designer=${withDesigner}`;
    const project = fs.mkdtempSync(path.join(tmpCwd, 'combo-'));
    process.chdir(project);
    try {
      const opts = { autoAllow: false, sdd, withJira, withDesigner, installStatusLine: false };
      claudeTarget.install('local', opts);
      const gemini = geminiTarget.install('local', opts);
      const claudeSet = commandNames(path.join(project, '.claude', 'commands'), '.md');
      const geminiSet = commandNames(geminiCommandsDir('local'), '.toml');
      expect(claudeSet.length, combo).toBeGreaterThan(0);
      expect(geminiSet, combo).toEqual(claudeSet);
      expect((gemini.notes ?? []).join('\n'), combo).not.toMatch(/skipped \/specship:/);
    } finally {
      process.chdir(tmpCwd);
    }
  }
}

/** Seed a Claude-only local install of the temp project with the given auto-allow choice. */
function seedClaude(autoAllow: boolean): void {
  claudeTarget.install('local', { autoAllow, sdd: true, installStatusLine: false });
  recordInstall('claude', 'local', tmpCwd, '0.0.0-test', process.env, { autoAllow, sdd: true, statusLine: false });
}

/** A3 — a switch carries auto-allow over: on writes Gemini's read-only policy, off writes none. */
function reqAgentswitch010A3(): void {
  seedClaude(true);
  const on = maybeAutoMigrate('gemini', { projectRoot: tmpCwd });
  expect(on.kind, on.line).toBe('installed');
  expect(fs.existsSync(geminiPolicyFile())).toBe(true);
  const policy = fs.readFileSync(geminiPolicyFile(), 'utf-8');
  // Gemini's loader reads only `[[rule]]` tables (DOM-SPECSHIP-005).
  expect(policy).toMatch(/^\[\[rule\]\]$/m);
  expect(policy).toContain('decision = "allow"');
  expect(policy).toContain('"specship_explore"');
  expect(policy).not.toMatch(/specship_(link_assert|jira_)/);

  // Fresh HOME + project: an install made with auto-allow off.
  fs.rmSync(tmpHome, { recursive: true, force: true });
  fs.mkdirSync(tmpHome, { recursive: true });
  const project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'parity-off-')));
  process.chdir(project);
  try {
    claudeTarget.install('local', { autoAllow: false, sdd: true, installStatusLine: false });
    recordInstall('claude', 'local', project, '0.0.0-test', process.env, { autoAllow: false, sdd: true, statusLine: false });
    const off = maybeAutoMigrate('gemini', { projectRoot: project });
    expect(off.kind, off.line).toBe('installed');
    expect(fs.existsSync(geminiPolicyFile())).toBe(false);
  } finally {
    process.chdir(tmpCwd);
    fs.rmSync(project, { recursive: true, force: true });
  }
}

/** A4 — a Gemini install prints one line naming the status line as unavailable, and exits 0. */
function reqAgentswitch010A4(): void {
  const notes = geminiTarget.install('local', { autoAllow: true, installStatusLine: true }).notes ?? [];
  const lines = notes.flatMap((n) => n.split('\n')).filter((l) => /status line.*unavailable in Gemini CLI/i.test(l));
  expect(lines).toHaveLength(1);

  // CLI level: the real binary prints that line once and exits 0.
  expect(fs.existsSync(BIN), `${BIN} missing — run npm run build`).toBe(true);
  const project = fs.mkdtempSync(path.join(tmpCwd, 'cli-'));
  const run = spawnSync(
    process.execPath,
    [BIN, 'install', '--target', 'gemini', '--location', 'local', '--yes', '--skip-index'],
    { cwd: project, env: { ...process.env }, encoding: 'utf8', timeout: 60_000 },
  );
  const out = run.stdout + run.stderr;
  expect(run.status, out).toBe(0);
  expect(out.split('\n').filter((l) => /status line.*unavailable in Gemini CLI/i.test(l))).toHaveLength(1);
}

/**
 * REQ-AGENTSWITCH-002.A3 — with `--sdd`, every skill and `/specship:*`
 * command the GEMINI.md SDD block names is installed for Gemini, and the
 * block is byte-identical to Claude's (REQ-GEMINI-004.A4).
 */
function reqAgentswitch002A3(): void {
  geminiTarget.install('local', { autoAllow: false, sdd: true });
  const geminiMd = fs.readFileSync(path.join(tmpCwd, 'GEMINI.md'), 'utf-8');
  const start = geminiMd.indexOf(SPECSHIP_SDD_SECTION_START);
  const end = geminiMd.indexOf(SPECSHIP_SDD_SECTION_END);
  expect(start).toBeGreaterThanOrEqual(0);
  const block = geminiMd.slice(start, end + SPECSHIP_SDD_SECTION_END.length);
  expect(block).toBe(getSddRuleBlock());

  // Skills the block names (`**spec-author**`) are installed under .gemini/skills.
  const skills = [...block.matchAll(/\*\*([a-z][\w-]*)\*\*/g)].map((m) => m[1]!);
  expect(skills).toContain('spec-author');
  for (const skill of skills) {
    expect(fs.existsSync(path.join(geminiSkillsDir('local'), skill, 'SKILL.md')), skill).toBe(true);
  }

  // Commands the block names (`/specship:spec implement`, `/specship:spec design`).
  const commands = [...block.matchAll(/\/specship:(\w+)(?: (\w+))?/g)].map((m) => ({ name: m[1]!, route: m[2] }));
  expect(commands.length).toBeGreaterThan(0);
  for (const { name, route } of commands) {
    const file = path.join(geminiCommandsDir('local'), 'specship', `${name}.toml`);
    expect(fs.existsSync(file), `/specship:${name}`).toBe(true);
    // A named sub-route is one the installed command actually routes.
    if (route) expect(fs.readFileSync(file, 'utf-8'), `/specship:${name} ${route}`).toContain(`\`${route}\``);
  }
}

describe('REQ-AGENTSWITCH-010 — Gemini install parity with Claude Code', () => {
  it('REQ-AGENTSWITCH-010.A1: every Claude artifact kind maps to a Gemini surface or a named no-surface reason', reqAgentswitch010A1);
  it('REQ-AGENTSWITCH-010.A2: the /specship:* command set matches Claude for every --sdd/--with-jira/--with-designer combination', reqAgentswitch010A2);
  it('REQ-AGENTSWITCH-010.A3: a Claude → Gemini switch carries auto-allow over as the read-only policy', reqAgentswitch010A3);
  it('REQ-AGENTSWITCH-010.A4: a Gemini install prints one status-line-unavailable line and exits 0', reqAgentswitch010A4, 90_000);
  it('REQ-AGENTSWITCH-002.A3: the GEMINI.md SDD block names only skills and commands the Gemini install provides', reqAgentswitch002A3);
});
