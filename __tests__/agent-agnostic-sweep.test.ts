/**
 * Shared code takes every host difference from the agent's profile
 * (REQ-AGENTSWITCH-019, specs/agent-switch.md). HOME is redirected to a tmpdir;
 * real files on disk.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { pickRecentInitializedProject } from '../src/agents/recent-project';
import { enumerate } from '../server/src/routes/projects';
import { resolveAutoAllow, resolveStatusLine } from '../src/installer/install-defaults';
import { allTargets } from '../src/installer/targets/registry';
import { claudeTarget } from '../src/installer/targets/claude';
import { geminiTarget } from '../src/installer/targets/gemini';

const BIN = path.resolve(__dirname, '../dist/bin/specship.js');
const ENV_KEYS = ['HOME', 'USERPROFILE', 'SPECSHIP_INSTALL_DIR'] as const;
let tmp: string;
let home: string;
let prev: Record<string, string | undefined>;

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agnostic-sweep-')));
  home = path.join(tmp, 'home');
  fs.mkdirSync(home, { recursive: true });
  prev = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.SPECSHIP_INSTALL_DIR = path.join(home, '.specship');
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (prev[k] === undefined) delete process.env[k];
    else process.env[k] = prev[k];
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** A Gemini CLI 0.33.0+ registry entry with one session, and nothing else on the machine. */
function geminiOnlyProject(name: string, mtime: Date): string {
  const root = path.join(tmp, name);
  fs.mkdirSync(path.join(root, '.specship'), { recursive: true });
  fs.writeFileSync(path.join(root, '.specship', 'specship.db'), '');
  const gem = path.join(home, '.gemini');
  const reg = path.join(gem, 'projects.json');
  const prior = fs.existsSync(reg) ? JSON.parse(fs.readFileSync(reg, 'utf-8')) : { projects: {} };
  prior.projects[root] = name;
  fs.mkdirSync(gem, { recursive: true });
  fs.writeFileSync(reg, JSON.stringify(prior));
  const chats = path.join(gem, 'tmp', name, 'chats');
  fs.mkdirSync(chats, { recursive: true });
  const s = path.join(chats, 'session-1.jsonl');
  fs.writeFileSync(s, '{}\n');
  fs.utimesSync(s, mtime, mtime);
  return root;
}

describe('shared code takes host differences from the profile (REQ-AGENTSWITCH-019)', () => {
  it('REQ-AGENTSWITCH-019.A1 a Gemini-only project is found from Gemini’s registry', reqAgentswitch019A1);
  async function reqAgentswitch019A1(): Promise<void> {
    geminiOnlyProject('older', new Date('2026-11-01T00:00:00Z'));
    const newer = geminiOnlyProject('newer', new Date('2026-11-05T00:00:00Z'));
    expect(fs.existsSync(path.join(home, '.specship', 'installed-agents.json'))).toBe(false);
    expect(fs.existsSync(path.join(home, '.claude'))).toBe(false);

    expect(await pickRecentInitializedProject()).toBe(newer);

    const listed = await enumerate(path.join(home, '.claude', 'projects'), {
      claudeJsonPath: path.join(home, '.claude.json'),
      recordPath: path.join(home, '.specship', 'installed-agents.json'),
      home,
    });
    expect(listed.map((p) => p.path)).toEqual([newer, path.join(tmp, 'older')]);
    expect(listed[0]).toMatchObject({ exists: true, initialized: true, sessionCount: 1 });
  }

  it('REQ-AGENTSWITCH-019.A3 --print-config picks the target from the registry', reqAgentswitch019A3);
  function reqAgentswitch019A3(): void {
    const print = (target: string) =>
      spawnSync(process.execPath, [BIN, 'install', '--print-config', '--target', target, '--location', 'global'], {
        encoding: 'utf-8', env: { ...process.env, SPECSHIP_NO_DAEMON: '1', SPECSHIP_AUTO_MIGRATE: '0' },
      }).stdout;
    expect(print('gemini')).toBe(geminiTarget.printConfig('global'));
    expect(print('claude')).toBe(claudeTarget.printConfig('global'));
    expect(print('auto')).toBe(claudeTarget.printConfig('global'));
  }

  it('REQ-AGENTSWITCH-019.A4 install defaults come from the host profile', reqAgentswitch019A4);
  function reqAgentswitch019A4(): void {
    const byId = Object.fromEntries(allTargets().map((t) => [t.id, t]));
    expect(resolveAutoAllow(undefined, byId.claude!.traits.autoAllowByDefault)).toBe(true);
    expect(resolveStatusLine(undefined, byId.claude!.traits.hasStatusLine)).toBe(true);
    expect(resolveAutoAllow(undefined, byId.gemini!.traits.autoAllowByDefault)).toBe(false);
    expect(resolveStatusLine(undefined, byId.gemini!.traits.hasStatusLine)).toBe(false);
    // An explicit flag still wins where the host has the surface.
    expect(resolveAutoAllow(false, true)).toBe(false);
    // Claude Code's location hint is unchanged.
    expect(claudeTarget.locationHint('local')).toBe('./.mcp.json + ./.claude/settings.json');
  }
});
