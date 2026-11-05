/**
 * REQ-AGENTSWITCH-013 (specs/agent-switch.md) — `specship install` with no
 * --target wires the agent it runs under; --target always wins.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { resolveInstallTargets } from '../src/installer';

const BIN = path.resolve(__dirname, '../dist/bin/specship.js');
let home: string;
let project: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'inst-default-home-'));
  project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'inst-default-p-')));
});
afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(project, { recursive: true, force: true });
});

function install(extraEnv: Record<string, string>, args: string[] = []): ReturnType<typeof spawnSync> {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home, SPECSHIP_INSTALL_DIR: path.join(home, '.specship'), SPECSHIP_NO_DAEMON: '1', ...extraEnv };
  for (const k of ['GEMINI_CLI', 'CLAUDECODE']) if (!(k in extraEnv)) delete env[k];
  return spawnSync(process.execPath, [BIN, 'install', '--yes', '--location', 'local', '--skip-index', ...args], { cwd: project, env, encoding: 'utf-8' });
}

describe('REQ-AGENTSWITCH-013 — install wires the agent it runs under', () => {
  it('REQ-AGENTSWITCH-013.A1: from a Gemini shell, no --target wires Gemini CLI and nothing under .claude/', reqAgentswitch013A1);
  function reqAgentswitch013A1(): void {
    expect(resolveInstallTargets(undefined, { GEMINI_CLI: '1' }).map((t) => t.id)).toEqual(['gemini']);
    expect(fs.existsSync(BIN), `${BIN} missing — run npm run build`).toBe(true);
    const r = install({ GEMINI_CLI: '1' });
    expect(r.status, String(r.stderr)).toBe(0);
    expect(fs.existsSync(path.join(project, '.gemini', 'settings.json'))).toBe(true);
    expect(fs.existsSync(path.join(project, '.claude'))).toBe(false);
    expect(fs.existsSync(path.join(project, '.mcp.json'))).toBe(false);
  }

  it('REQ-AGENTSWITCH-013.A2: with no agent, or both claimed, no --target wires Claude Code', reqAgentswitch013A2);
  function reqAgentswitch013A2(): void {
    expect(resolveInstallTargets(undefined, {}).map((t) => t.id)).toEqual(['claude']);
    expect(resolveInstallTargets(undefined, { GEMINI_CLI: '1', CLAUDECODE: '1' }).map((t) => t.id)).toEqual(['claude']);
    expect(resolveInstallTargets('auto', { CLAUDECODE: '1' }).map((t) => t.id)).toEqual(['claude']);
    expect(resolveInstallTargets('all', { GEMINI_CLI: '1' }).map((t) => t.id)).toEqual(['claude']);
  }

  it('REQ-AGENTSWITCH-013.A3: --target claude from a Gemini shell wires Claude Code', reqAgentswitch013A3);
  function reqAgentswitch013A3(): void {
    expect(resolveInstallTargets('claude', { GEMINI_CLI: '1' }).map((t) => t.id)).toEqual(['claude']);
    const r = install({ GEMINI_CLI: '1' }, ['--target', 'claude']);
    expect(r.status, String(r.stderr)).toBe(0);
    expect(fs.existsSync(path.join(project, '.mcp.json'))).toBe(true);
    expect(fs.existsSync(path.join(project, '.gemini', 'settings.json'))).toBe(false);
  }
});
