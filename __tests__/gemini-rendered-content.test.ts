/**
 * REQ-AGENTSWITCH-014 (specs/agent-switch.md) — every skill, command and
 * steering file written for Gemini CLI reads correctly for a Gemini user.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';

const BIN = path.resolve(__dirname, '../dist/bin/specship.js');
let root: string;
let project: string;

/** Every file a full Gemini install wrote, with its text. */
function writtenFiles(): Array<{ rel: string; text: string }> {
  const out: Array<{ rel: string; text: string }> = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else out.push({ rel: path.relative(project, abs), text: fs.readFileSync(abs, 'utf-8') });
    }
  };
  walk(path.join(project, '.gemini'));
  out.push({ rel: 'GEMINI.md', text: fs.readFileSync(path.join(project, 'GEMINI.md'), 'utf-8') });
  return out;
}

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gem-content-')));
  project = path.join(root, 'p');
  fs.mkdirSync(project);
  const env: NodeJS.ProcessEnv = {
    ...process.env, HOME: path.join(root, 'home'), USERPROFILE: path.join(root, 'home'),
    SPECSHIP_INSTALL_DIR: path.join(root, 'home', '.specship'), SPECSHIP_GEMINI_VERSION: '0.28.0', SPECSHIP_NO_DAEMON: '1',
  };
  const r = spawnSync(process.execPath, [BIN, 'install', '--target', 'gemini', '--location', 'local', '--yes', '--skip-index', '--sdd', '--with-jira', '--with-designer'], { cwd: project, env, encoding: 'utf-8' });
  if (r.status !== 0) throw new Error(`gemini install failed: ${r.stderr}`);
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe('REQ-AGENTSWITCH-014 — Gemini-rendered skills and commands', () => {
  it('REQ-AGENTSWITCH-014.A1: no written file sends a Gemini user to a Claude-only command or tool', reqAgentswitch014A1);
  function reqAgentswitch014A1(): void {
    const files = writtenFiles();
    expect(files.some((f) => f.rel.includes(path.join('skills', 'spec-author')))).toBe(true);
    const banned: Array<[RegExp, string]> = [
      [/\bclaude mcp\b/, 'claude mcp'],
      [/\bAskUserQuestion\b/, 'AskUserQuestion'],
      [/\bmcp__/, 'mcp__ tool names'],
      [/\$ARGUMENTS\b/, '$ARGUMENTS'],
      [/`(Write|Edit|Read|Grep|Glob)` tool\b/, 'a Claude built-in named as a tool'],
      [/\bthe `(Write|Edit|Read|Grep|Glob)`/, 'a Claude built-in named as a tool'],
    ];
    const hits = files.flatMap((f) => banned.filter(([re]) => re.test(f.text)).map(([, what]) => `${f.rel}: ${what}`));
    expect(hits).toEqual([]);
  }

  it('REQ-AGENTSWITCH-014.A2: with skills installed, /specship:spec keeps the design-md skill and no dangling reference', reqAgentswitch014A2);
  function reqAgentswitch014A2(): void {
    const spec = fs.readFileSync(path.join(project, '.gemini', 'commands', 'specship', 'spec.toml'), 'utf-8');
    expect(spec).toMatch(/`design-md` skill/);
    // "use that skill directly" must follow a sentence that names the skill
    // (it was once left dangling after the name was stripped).
    for (const m of spec.matchAll(/use that skill directly/g)) {
      expect(spec.slice(Math.max(0, m.index! - 400), m.index!)).toMatch(/`design-md` skill/);
    }
    expect(fs.existsSync(path.join(project, '.gemini', 'skills', 'design-md', 'SKILL.md'))).toBe(true);
  }

  it('REQ-AGENTSWITCH-014.A3: the /specship:check memory-file route names GEMINI.md, not CLAUDE.md', reqAgentswitch014A3);
  function reqAgentswitch014A3(): void {
    const check = fs.readFileSync(path.join(project, '.gemini', 'commands', 'specship', 'check.toml'), 'utf-8');
    expect(check).toContain('GEMINI.md');
    expect(check).not.toContain('CLAUDE.md');
  }
});
