/**
 * REQ-AGENTSWITCH-005 — a Gemini install carries SpecShip's skills and the
 * explorer subagent when the installed Gemini CLI supports them, and says
 * what it skipped (and why) when it does not.
 *
 * HOME / CWD are redirected to tmpdirs (same pattern as
 * installer-targets.test.ts). The Gemini version probe is pinned through
 * `SPECSHIP_GEMINI_VERSION`, so no real `gemini` binary is needed.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import {
  GEMINI_MIN_AGENTS,
  GEMINI_MIN_SKILLS,
  geminiAgentsDir,
  geminiSkillsDir,
  geminiTarget,
  geminiVersionSupports,
  renderGeminiExplorerAgent,
} from '../src/installer/targets/gemini';
import { SHIPPED_SKILLS } from '../src/installer/targets/claude';

const ENV_KEYS = ['HOME', 'USERPROFILE', 'APPDATA', 'XDG_CONFIG_HOME', 'SPECSHIP_GEMINI_VERSION'] as const;
const BIN = path.resolve(__dirname, '../dist/bin/specship.js');
const AGENT_SOURCE = path.resolve(__dirname, '../agents/specship-explorer.md');

let tmpHome: string;
let tmpCwd: string;
let origCwd: string;
let prevEnv: Record<string, string | undefined>;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-sa-home-'));
  tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-sa-cwd-'));
  prevEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;
  process.env.APPDATA = path.join(tmpHome, '.config');
  process.env.XDG_CONFIG_HOME = path.join(tmpHome, '.config');
  origCwd = process.cwd();
  process.chdir(tmpCwd);
});

afterEach(() => {
  process.chdir(origCwd);
  for (const k of ENV_KEYS) {
    if (prevEnv[k] === undefined) delete process.env[k];
    else process.env[k] = prevEnv[k];
  }
  fs.rmSync(tmpHome, { recursive: true, force: true });
  fs.rmSync(tmpCwd, { recursive: true, force: true });
});

/** The tool names the shipped (Claude-format) agent lists, bare. */
function sourceToolNames(): string[] {
  const src = fs.readFileSync(AGENT_SOURCE, 'utf-8');
  const line = src.split('\n').find((l) => l.startsWith('tools:'))!;
  return line.slice('tools:'.length).split(',').map((t) => t.trim().replace(/^mcp__specship__/, '')).filter(Boolean);
}

/** A1 — supporting Gemini: skills land under .gemini/skills; uninstall removes only ours. */
function reqAgentswitch005A1(): void {
  process.env.SPECSHIP_GEMINI_VERSION = GEMINI_MIN_SKILLS;
  const skills = geminiSkillsDir('local');
  const userSkill = path.join(skills, 'my-skill', 'SKILL.md');
  const userBody = '---\nname: my-skill\ndescription: mine\n---\nhello\n';
  fs.mkdirSync(path.dirname(userSkill), { recursive: true });
  fs.writeFileSync(userSkill, userBody);

  const result = geminiTarget.install('local', { autoAllow: false });
  for (const name of SHIPPED_SKILLS) {
    const file = path.join(skills, name);
    expect(fs.existsSync(file), file).toBe(true);
    // Tool names in those files are the names Gemini uses.
    expect(fs.readFileSync(file, 'utf-8')).not.toMatch(/mcp__specship__/);
  }
  expect(fs.existsSync(path.join(skills, 'spec-author', 'SKILL.md'))).toBe(true);
  expect(fs.existsSync(path.join(skills, 'design-md', 'SKILL.md'))).toBe(true);
  expect((result.notes ?? []).join('\n')).not.toMatch(/skipped skills/);

  // Re-running is idempotent.
  const again = geminiTarget.install('local', { autoAllow: false });
  for (const name of SHIPPED_SKILLS) {
    expect(again.files.find((f) => f.path === path.join(skills, name))?.action).toBe('unchanged');
  }

  geminiTarget.uninstall('local');
  for (const name of SHIPPED_SKILLS) expect(fs.existsSync(path.join(skills, name))).toBe(false);
  expect(fs.existsSync(path.join(skills, 'spec-author'))).toBe(false);
  expect(fs.existsSync(path.join(skills, 'design-md'))).toBe(false);
  expect(fs.readFileSync(userSkill, 'utf-8')).toBe(userBody);

  // A second uninstall finds nothing of ours left.
  const second = geminiTarget.uninstall('local');
  expect(second.files.some((f) => f.path.startsWith(skills) && f.action === 'removed')).toBe(false);
  expect(second.files.find((f) => f.path.endsWith('specship-explorer.md'))).toBeUndefined();
}

/** A2 (property) — the installed subagent names Gemini's tool names, never `mcp__specship__`. */
function reqAgentswitch005A2(): void {
  const rendered = renderGeminiExplorerAgent();
  expect(rendered).toContain('specship_explore');
  expect(rendered).not.toMatch(/mcp__specship__/);
  // Only keys Gemini's strict frontmatter schema accepts; `model: inherit` dropped.
  const front = /^---\n([\s\S]*?)\n---\n/.exec(rendered)![1]!;
  const keys = front.split('\n').filter((l) => /^[a-z_]+:/.test(l)).map((l) => l.split(':')[0]);
  expect(new Set(keys)).toEqual(new Set(['name', 'description', 'tools']));
  for (const tool of sourceToolNames()) expect(rendered).toContain(`  - specship__${tool}`);

  // Property: any tool list the asset could carry renders with no Claude prefix.
  const toolName = fc.stringMatching(/^specship_[a-z]{1,12}$/);
  fc.assert(
    fc.property(fc.array(toolName, { minLength: 1, maxLength: 8 }), fc.boolean(), (tools, prefixed) => {
      const list = tools.map((t) => (prefixed ? `mcp__specship__${t}` : t)).join(', ');
      const src = `---\nname: specship-explorer\ndescription: d\ntools: ${list}\nmodel: inherit\n---\nUse \`mcp__specship__${tools[0]}\` first.\n`;
      const out = renderGeminiExplorerAgent(src);
      expect(out).not.toMatch(/mcp__specship__/);
      expect(out).not.toMatch(/^model:/m);
      for (const t of tools) expect(out).toContain(`  - specship__${t}`);
    }),
  );

  // The file install actually writes satisfies the same property.
  process.env.SPECSHIP_GEMINI_VERSION = GEMINI_MIN_AGENTS;
  const result = geminiTarget.install('local', { autoAllow: false });
  const agentFile = path.join(geminiAgentsDir('local'), 'specship-explorer.md');
  const written = fs.readFileSync(agentFile, 'utf-8');
  expect(written).toBe(rendered);
  expect(written).not.toMatch(/mcp__specship__/);
  expect((result.notes ?? []).join('\n')).toContain('experimental.enableAgents');

  geminiTarget.uninstall('local');
  expect(fs.existsSync(agentFile)).toBe(false);
}

/** A3 — Gemini without subagent support: the skip is named with the version it needs; exit 0. */
function reqAgentswitch005A3(): void {
  process.env.SPECSHIP_GEMINI_VERSION = '0.27.9';
  expect(geminiVersionSupports('0.27.9', GEMINI_MIN_AGENTS)).toBe(false);
  let result!: ReturnType<typeof geminiTarget.install>;
  expect(() => { result = geminiTarget.install('local', { autoAllow: false }); }).not.toThrow();
  expect(fs.existsSync(path.join(geminiAgentsDir('local'), 'specship-explorer.md'))).toBe(false);
  expect(fs.existsSync(geminiSkillsDir('local'))).toBe(false);
  const notes = (result.notes ?? []).join('\n');
  expect(notes).toMatch(new RegExp(`skipped subagent specship-explorer — needs Gemini CLI >= ${GEMINI_MIN_AGENTS.replace(/\./g, '\\.')} \\(found 0\\.27\\.9\\)`));
  expect(notes).toContain('skipped skills spec-author, design-md');

  // Unknown version (Gemini not on PATH) is skipped too, never guessed.
  process.env.SPECSHIP_GEMINI_VERSION = 'none';
  const unknown = (geminiTarget.install('local', { autoAllow: false }).notes ?? []).join('\n');
  expect(unknown).toMatch(/skipped subagent specship-explorer — needs Gemini CLI >= 0\.28\.0 \(Gemini CLI version not found\)/);

  // CLI level: the real binary prints the skip and exits 0.
  if (!fs.existsSync(BIN)) return;
  const run = spawnSync(
    process.execPath,
    [BIN, 'install', '--target', 'gemini', '--location', 'local', '--yes', '--skip-index'],
    {
      cwd: tmpCwd,
      env: { ...process.env, HOME: tmpHome, USERPROFILE: tmpHome, SPECSHIP_GEMINI_VERSION: '0.27.9' },
      encoding: 'utf8',
      timeout: 60_000,
    },
  );
  const out = run.stdout + run.stderr;
  expect(run.status, out).toBe(0);
  expect(out).toContain('specship-explorer');
  expect(out).toContain(GEMINI_MIN_AGENTS);
}

describe('REQ-AGENTSWITCH-005 — Gemini skills + explorer subagent', () => {
  it('REQ-AGENTSWITCH-005.A1: a skills-capable Gemini gets spec-author + design-md; uninstall leaves user skills', reqAgentswitch005A1);
  it('REQ-AGENTSWITCH-005.A2: the installed subagent names specship_explore, never mcp__specship__specship_explore', reqAgentswitch005A2);
  it('REQ-AGENTSWITCH-005.A3: without subagent support the install names the skipped subagent + needed version and exits 0', reqAgentswitch005A3, 90_000);
});
