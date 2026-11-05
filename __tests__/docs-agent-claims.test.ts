import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawnSync } from 'child_process';

/**
 * AGENTSWITCH-DOC REQ-AGENTSWITCH-015 — documentation describes what each
 * agent gets today. SpecShip supports Claude Code and Gemini CLI; Gemini gets
 * hooks, commands, skills and the subagent, so no page may call it MCP-only or
 * call SpecShip "Claude Code only". The offline wrappers pass the agent choice
 * on to the bundle installer.
 */

const ROOT = path.join(__dirname, '..');

/** README.md, CLAUDE.md and every .md/.mdx page of the documentation site. */
function agentClaimDocs(): string[] {
  const out = [path.join(ROOT, 'README.md'), path.join(ROOT, 'CLAUDE.md')];
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.mdx?$/.test(e.name)) out.push(p);
    }
  };
  walk(path.join(ROOT, 'site/src/content/docs'));
  return out;
}

/** Phrases that are always stale. */
const STALE_PHRASES = /\bmcp-only\b|\bmcp tools only\b|\bmcp-entry-only\b|\bmcp (server )?entry only\b/i;
/** "Claude Code only" is true of exactly one thing: the status line. */
const CLAUDE_ONLY = /\bclaude code only\b/i;
/** Sentences that deny Gemini a surface it now gets. */
const GEMINI_DENIALS: RegExp[] = [
  /gemini[^.\n]{0,120}\b(gets?|has|receives?)\s+(no|none of the)\b[^.\n]{0,60}\b(hooks?|commands?|skills?|subagents?)\b/i,
  /\bno\s+(hooks?|slash commands|skills?|subagents?)\b[^.\n]{0,100}\bgemini\b/i,
  /\b(hooks?|slash commands|skills?|subagents?)\b[^.\n]{0,100}\bno gemini equivalent\b/i,
  /gemini[^.\n]{0,80}\bnothing else\b/i,
];

function reqAgentswitch015A1(): void {
  const offenders: string[] = [];
  for (const file of agentClaimDocs()) {
    const rel = path.relative(ROOT, file);
    fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      const at = `${rel}:${i + 1}: ${line.trim().slice(0, 160)}`;
      if (STALE_PHRASES.test(line)) offenders.push(at);
      else if (CLAUDE_ONLY.test(line) && !/status[- ]line/i.test(line)) offenders.push(at);
      else if (GEMINI_DENIALS.some((re) => re.test(line))) offenders.push(at);
    });
  }
  expect(offenders, `stale agent claims:\n${offenders.join('\n')}`).toEqual([]);
}

function reqAgentswitch015A2(): void {
  for (const rel of ['README.md', 'site/src/content/docs/getting-started/configuration.md']) {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    expect(text, `${rel} documents SPECSHIP_AUTO_MIGRATE`).toContain('SPECSHIP_AUTO_MIGRATE');
    expect(text, `${rel} documents "autoMigrate"`).toContain('autoMigrate');
  }
}

function reqAgentswitch015A3(): void {
  // The .ps1 wrapper can't run here: check by source that it declares -Target
  // and forwards it (and the wiring switches) to the bundle's install.ps1.
  const ps1 = fs.readFileSync(path.join(ROOT, 'scripts/offline-install.ps1'), 'utf8');
  expect(ps1).toMatch(/\[string\]\$Target\b/);
  expect(ps1).toMatch(/\$fwd\['Target'\]\s*=\s*\$Target/);
  expect(ps1).toMatch(/\$fwd\['Global'\]/);
  expect(ps1).toMatch(/\$fwd\['Path'\]/);
  expect(ps1).toMatch(/Alias\('SkipWire'\)/);
  expect(ps1).toMatch(/&\s*\$installer\s+@fwd/);

  if (process.platform === 'win32') return;

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'specship-offline-wrap-'));
  try {
    const bundle = path.join(tmp, 'specship-stub');
    const argsFile = path.join(tmp, 'args.txt');
    fs.mkdirSync(path.join(bundle, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(bundle, 'bin', 'specship'), '#!/bin/sh\n', { mode: 0o755 });
    fs.writeFileSync(
      path.join(bundle, 'install.sh'),
      `#!/bin/sh\nfor a in "$@"; do printf '%s\\n' "$a"; done > "${argsFile}"\n`,
      { mode: 0o755 },
    );
    const res = spawnSync(
      'sh',
      [path.join(ROOT, 'scripts/offline-install.sh'), bundle, '--target', 'gemini', '--global'],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          SPECSHIP_INSTALL_DIR: path.join(tmp, 'install'),
          SPECSHIP_BIN_DIR: path.join(tmp, 'bin'),
        },
      },
    );
    expect(res.status, res.stderr).toBe(0);
    const forwarded = fs.readFileSync(argsFile, 'utf8').trim().split('\n');
    expect(forwarded).toEqual(['--target', 'gemini', '--global']);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

describe('docs describe what each agent gets (AGENTSWITCH-DOC)', () => {
  it('REQ-AGENTSWITCH-015.A1: no page calls Gemini MCP-only or SpecShip Claude Code only', reqAgentswitch015A1);
  it('REQ-AGENTSWITCH-015.A2: README and configuration reference document the auto-migrate opt-out', reqAgentswitch015A2);
  it('REQ-AGENTSWITCH-015.A3: the offline wrappers forward the agent choice to the bundle installer', reqAgentswitch015A3);
});
