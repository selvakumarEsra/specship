/**
 * REQ-AGENTSWITCH-011 / 012 (specs/agent-switch.md) — project discovery finds
 * every agent's projects, and user-visible text names the agents involved.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { enumerate } from '../server/src/routes/projects';
import { pickRecentInitializedProject } from '../src/agents/recent-project';
import { mineProposals } from '../src/reflect/miner';
import { GEMINI_CLI_TRAITS } from '../src/activation/hook-output';
import { openMemoryDb } from './helpers/memory-db';
import type { SqliteDatabase } from '../src/db/sqlite-adapter';

const BIN = path.resolve(__dirname, '../dist/bin/specship.js');
const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'schema.sql'), 'utf-8');
const ENV_KEYS = ['HOME', 'USERPROFILE', 'SPECSHIP_INSTALL_DIR'] as const;
let tmp: string;
let home: string;
let installDir: string;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-disc-')));
  home = path.join(tmp, 'home');
  installDir = path.join(home, '.specship');
  fs.mkdirSync(installDir, { recursive: true });
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.SPECSHIP_INSTALL_DIR = installDir;
});
afterEach(() => {
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** An initialized project (a `.specship/` with a database file) recorded for `agent`. */
function recordedProject(name: string, agent: string, recordedAt: string): string {
  const p = path.join(tmp, name);
  fs.mkdirSync(path.join(p, '.specship'), { recursive: true });
  fs.writeFileSync(path.join(p, '.specship', 'specship.db'), '');
  const file = path.join(installDir, 'installed-agents.json');
  const prior = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf-8')) : { schemaVersion: 1, entries: [] };
  prior.entries.push({ agent, scope: 'local', projectRoot: p, version: '0.0.0', recordedAt });
  fs.writeFileSync(file, JSON.stringify(prior));
  return p;
}

describe('REQ-AGENTSWITCH-011 — project discovery covers every agent', () => {
  it('REQ-AGENTSWITCH-011.A1: a Gemini-only machine lists its recorded project in the dashboard picker', reqAgentswitch011A1);
  async function reqAgentswitch011A1(): Promise<void> {
    const p = recordedProject('gem-proj', 'gemini', '2026-11-05T00:00:00Z');
    expect(fs.existsSync(path.join(home, '.claude'))).toBe(false);
    const listed = await enumerate(path.join(home, '.claude', 'projects'), {
      claudeJsonPath: path.join(home, '.claude.json'),
      recordPath: path.join(installDir, 'installed-agents.json'),
    });
    expect(listed.map((e) => e.path)).toEqual([p]);
    expect(listed[0]).toMatchObject({ exists: true, initialized: true });
  }

  it('REQ-AGENTSWITCH-011.A2: specship desktop auto-picks the recorded Gemini project', reqAgentswitch011A2);
  async function reqAgentswitch011A2(): Promise<void> {
    recordedProject('older', 'gemini', '2026-11-01T00:00:00Z');
    const newer = recordedProject('newer', 'gemini', '2026-11-05T00:00:00Z');
    expect(await pickRecentInitializedProject()).toBe(newer);
  }

  it('REQ-AGENTSWITCH-011.A3: a Claude-only machine lists exactly its Claude projects', reqAgentswitch011A3);
  async function reqAgentswitch011A3(): Promise<void> {
    const q = path.join(tmp, 'claude-proj');
    fs.mkdirSync(path.join(q, '.specship'), { recursive: true });
    const slug = q.replace(/[^A-Za-z0-9]/g, '-');
    const claudeRoot = path.join(home, '.claude', 'projects');
    fs.mkdirSync(path.join(claudeRoot, slug), { recursive: true });
    fs.writeFileSync(path.join(claudeRoot, slug, 's1.jsonl'), '{}\n');
    fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ projects: { [q]: {} } }));
    const listed = await enumerate(claudeRoot, {
      claudeJsonPath: path.join(home, '.claude.json'),
      claudeRoot,
      recordPath: path.join(installDir, 'installed-agents.json'),
    });
    expect(listed.map((e) => e.path)).toEqual([q]);
    expect(listed[0]!.sessionCount).toBe(1);
  }
});

describe('REQ-AGENTSWITCH-012 — user-visible text names the agents involved', () => {
  it('REQ-AGENTSWITCH-012.A2: install --target gemini prints no line naming Claude Code', reqAgentswitch012A2);
  function reqAgentswitch012A2(): void {
    expect(fs.existsSync(BIN), `${BIN} missing — run npm run build`).toBe(true);
    const project = path.join(tmp, 'p');
    fs.mkdirSync(project);
    const env: NodeJS.ProcessEnv = { ...process.env, SPECSHIP_NO_DAEMON: '1', SPECSHIP_GEMINI_VERSION: '0.28.0' };
    delete env.CLAUDECODE;
    delete env.GEMINI_CLI;
    const r = spawnSync(process.execPath, [BIN, 'install', '--target', 'gemini', '--location', 'local', '--yes', '--skip-index'], { cwd: project, env, encoding: 'utf-8' });
    expect(r.status, r.stderr).toBe(0);
    const out = `${r.stdout}\n${r.stderr}`;
    expect(out).toContain('Gemini CLI');
    expect(out).not.toMatch(/Claude Code/);
  }

  it('REQ-AGENTSWITCH-012.A3: a reflect hook proposal for Gemini names AfterTool, not PostToolUse', reqAgentswitch012A3);
  function reqAgentswitch012A3(): void {
    const db = openMemoryDb();
    db.exec(SCHEMA);
    db.exec('PRAGMA foreign_keys = OFF;');
    const project = path.join(tmp, 'mine');
    for (const s of ['s1', 's2']) {
      db.prepare('INSERT INTO claude_sessions (id, project_path, source_file) VALUES (?, ?, ?)').run(s, project, `${s}.json`);
      for (let i = 0; i < 3; i++) {
        db.prepare(`INSERT INTO claude_tool_calls (prompt_id, session_id, assistant_uuid, tool_name, input_summary, result_length, ts)
                    VALUES (?, ?, ?, 'Bash', 'npm run build', 10, ?)`).run(`${s}-p`, s, `${s}-a${i}`, i);
      }
    }
    const proposals = mineProposals(db as unknown as SqliteDatabase, { projectRoot: project, homeDir: home, host: GEMINI_CLI_TRAITS });
    const hook = proposals.find((p) => p.title.startsWith('Automate'));
    expect(hook, 'repeated command across sessions proposes a hook').toBeDefined();
    expect(hook!.body).toContain('AfterTool');
    expect(hook!.body).not.toContain('PostToolUse');
  }
});
