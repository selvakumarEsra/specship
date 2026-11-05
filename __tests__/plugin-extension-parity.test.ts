/**
 * REQ-AGENTSWITCH-016 (specs/agent-switch.md) — the Claude Code plugin and the
 * Gemini CLI extension match what `specship install` wires.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync, execFileSync } from 'child_process';

const ROOT = path.resolve(__dirname, '..');
const read = (rel: string) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf-8'));
const pkg = read('package.json');

function geminiAvailable(): boolean {
  try { execFileSync('gemini', ['--version'], { stdio: 'ignore', timeout: 20000 }); return true; } catch { return false; }
}

describe('REQ-AGENTSWITCH-016 — plugin and extension parity', () => {
  it('REQ-AGENTSWITCH-016.A1: the plugin hooks equal what install --target claude writes', reqAgentswitch016A1);
  function reqAgentswitch016A1(): void {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'sync-claude-plugin.mjs'), '--check'], { encoding: 'utf-8' });
    expect(r.status, r.stderr || r.stdout).toBe(0);
    const commands = JSON.stringify(read('hooks/hooks.json'));
    for (const c of ['specship sync --quiet', 'specship cheatsheet', 'specship spec-nudge', 'specship steer-nudge', 'specship search-intercept', '--drift-summary']) {
      expect(commands).toContain(c);
    }
  }

  it('REQ-AGENTSWITCH-016.A2: the plugin enables no integration and carries the package version', reqAgentswitch016A2);
  function reqAgentswitch016A2(): void {
    const plugin = read('.claude-plugin/plugin.json');
    expect(plugin.version).toBe(pkg.version);
    expect(plugin.mcpServers?.specship?.command).toBe('specship');
    expect(plugin.mcpServers.specship.env?.SPECSHIP_INTEGRATIONS).toBeUndefined();
  }

  it('REQ-AGENTSWITCH-016.A3: the built Gemini extension carries the MCP server, commands, skills, agent and context', reqAgentswitch016A3, 120_000);
  function reqAgentswitch016A3(): void {
    const dir = path.join(ROOT, 'gemini-extension');
    expect(fs.existsSync(dir), 'gemini-extension/ missing — run npm run build').toBe(true);
    const manifest = read('gemini-extension/gemini-extension.json');
    expect(manifest).toMatchObject({ name: 'specship', version: pkg.version, contextFileName: 'GEMINI.md' });
    expect(manifest.mcpServers.specship).toMatchObject({ command: 'specship', args: ['serve', '--mcp'] });
    expect(pkg.files).toContain('gemini-extension');
    for (const cmd of ['spec', 'check', 'explore', 'learn', 'day']) {
      expect(fs.existsSync(path.join(dir, 'commands', 'specship', `${cmd}.toml`)), cmd).toBe(true);
    }
    for (const f of ['skills/spec-author/SKILL.md', 'skills/design-md/SKILL.md', 'agents/specship-explorer.md', 'GEMINI.md', 'hooks/hooks.json']) {
      expect(fs.existsSync(path.join(dir, f)), f).toBe(true);
    }
    expect(read('gemini-extension/hooks/hooks.json').hooks.BeforeAgent).toBeDefined();
    // Gemini CLI's own validator, when the binary is on PATH (no credentials needed).
    if (geminiAvailable()) {
      const v = spawnSync('gemini', ['extensions', 'validate', dir], { encoding: 'utf-8', env: { ...process.env, GEMINI_API_KEY: process.env.GEMINI_API_KEY || 'placeholder-not-used' }, timeout: 60000 });
      expect(`${v.stdout}${v.stderr}`).toMatch(/successfully validated/);
    }
  }
});
