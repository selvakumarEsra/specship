/**
 * Installer tests — Claude Code only.
 *
 * Exercises the Claude target against the agent-target contract:
 *   - `install` writes the expected files
 *   - re-running `install` is byte-identical (idempotent)
 *   - sibling MCP servers / unrelated config is preserved
 *   - `uninstall` reverses `install`
 *   - `printConfig` returns parseable, non-empty content
 *
 * Plus Claude-specific scenarios: `./.mcp.json` is the project-scope
 * file (not `./.claude.json`), legacy CLAUDE.md instructions blocks are
 * stripped on install / uninstall (#529), and pre-0.8 auto-sync hooks
 * are cleaned up without touching the user's unrelated hooks.
 *
 * HOME is redirected to a tmpdir via the env vars `os.homedir()` reads
 * (HOME / USERPROFILE), and CWD via `process.chdir`. No real
 * `~/.claude/` is ever touched.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ALL_TARGETS, getTarget } from '../src/installer/targets/registry';
import { uninstallTargets } from '../src/installer';
import {
  claudeTarget,
  cleanupLegacyHooks,
  cleanupCurrentHooks,
  writeStatusLineEntry,
  removeStatusLineEntry,
  statusLineState,
} from '../src/installer/targets/claude';

function mkTmpDir(label: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `cg-targets-${label}-`));
}

function setHome(dir: string): { restore: () => void } {
  const prev = {
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    APPDATA: process.env.APPDATA,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
  };
  process.env.HOME = dir;
  process.env.USERPROFILE = dir;
  process.env.APPDATA = path.join(dir, '.config');
  process.env.XDG_CONFIG_HOME = path.join(dir, '.config');
  return {
    restore() {
      if (prev.HOME === undefined) delete process.env.HOME; else process.env.HOME = prev.HOME;
      if (prev.USERPROFILE === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = prev.USERPROFILE;
      if (prev.APPDATA === undefined) delete process.env.APPDATA; else process.env.APPDATA = prev.APPDATA;
      if (prev.XDG_CONFIG_HOME === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = prev.XDG_CONFIG_HOME;
    },
  };
}

// A marker-delimited SpecShip block exactly as a pre-#529 installer
// wrote it. The current installer no longer writes an instructions
// file, but install (self-heal on upgrade) and uninstall still strip a
// block a prior install left, so we plant this to exercise it.
const LEGACY_BLOCK = [
  '<!-- SPECSHIP_START -->',
  '## SpecShip',
  '',
  'Prefer `specship_search` / `specship_callers` over grep.',
  '<!-- SPECSHIP_END -->',
].join('\n');

function listAllFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listAllFiles(full));
    else out.push(full);
  }
  return out;
}

describe('Installer targets — contract', () => {
  let tmpHome: string;
  let tmpCwd: string;
  let origCwd: string;
  let homeRestore: { restore: () => void };

  beforeEach(() => {
    tmpHome = mkTmpDir('home');
    tmpCwd = mkTmpDir('cwd');
    origCwd = process.cwd();
    process.chdir(tmpCwd);
    homeRestore = setHome(tmpHome);
  });

  afterEach(() => {
    homeRestore.restore();
    process.chdir(origCwd);
    fs.rmSync(tmpHome, { recursive: true, force: true });
    fs.rmSync(tmpCwd, { recursive: true, force: true });
  });

  // ALL_TARGETS is just [claudeTarget] now, but the loop is preserved so
  // re-adding another agent automatically picks up the contract suite.
  for (const target of ALL_TARGETS) {
    describe(target.id, () => {
      const supportedLocations = (['global', 'local'] as const).filter((l) =>
        target.supportsLocation(l),
      );

      for (const location of supportedLocations) {
        describe(`location=${location}`, () => {
          it('install writes files; detect.alreadyConfigured becomes true', () => {
            expect(target.detect(location).alreadyConfigured).toBe(false);

            const result = target.install(location, { autoAllow: true });
            expect(result.files.length).toBeGreaterThan(0);
            for (const file of result.files) {
              if (file.action !== 'unchanged') {
                expect(fs.existsSync(file.path)).toBe(true);
              }
            }

            expect(target.detect(location).alreadyConfigured).toBe(true);
          });

          it('re-running install is idempotent (no actions other than unchanged)', () => {
            target.install(location, { autoAllow: true });
            const second = target.install(location, { autoAllow: true });
            for (const file of second.files) {
              expect(file.action).toBe('unchanged');
            }
          });

          it('install preserves a pre-existing sibling MCP server', () => {
            const paths = target.describePaths(location);
            const jsonPath = paths.find((p) => /\.jsonc?$/.test(p))!;

            fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
            fs.writeFileSync(
              jsonPath,
              JSON.stringify({ mcpServers: { other: { command: 'x' } } }, null, 2) + '\n',
            );

            target.install(location, { autoAllow: true });

            const after = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
            expect(after.mcpServers.other).toBeDefined();
            expect(after.mcpServers.specship).toBeDefined();
          });

          it('uninstall reverses install (alreadyConfigured returns to false)', () => {
            target.install(location, { autoAllow: true });
            expect(target.detect(location).alreadyConfigured).toBe(true);

            target.uninstall(location);
            expect(target.detect(location).alreadyConfigured).toBe(false);
          });

          it('printConfig returns non-empty output without writing anything', () => {
            const before = listAllFiles(tmpHome).concat(listAllFiles(tmpCwd));
            const out = target.printConfig(location);
            expect(out.length).toBeGreaterThan(0);
            const after = listAllFiles(tmpHome).concat(listAllFiles(tmpCwd));
            expect(after.sort()).toEqual(before.sort());
          });
        });
      }
    });
  }
});

describe('Claude target — specifics', () => {
  let tmpHome: string;
  let tmpCwd: string;
  let origCwd: string;
  let homeRestore: { restore: () => void };

  beforeEach(() => {
    tmpHome = mkTmpDir('home');
    tmpCwd = mkTmpDir('cwd');
    origCwd = process.cwd();
    process.chdir(tmpCwd);
    homeRestore = setHome(tmpHome);
  });

  afterEach(() => {
    homeRestore.restore();
    process.chdir(origCwd);
    fs.rmSync(tmpHome, { recursive: true, force: true });
    fs.rmSync(tmpCwd, { recursive: true, force: true });
  });

  it('local install writes ./.mcp.json (project scope), not ./.claude.json', () => {
    const result = claudeTarget.install('local', { autoAllow: false });
    expect(result.files.some((f) => f.path.replace(/\\/g, '/').endsWith('/.mcp.json'))).toBe(true);
    expect(fs.existsSync(path.join(tmpCwd, '.mcp.json'))).toBe(true);
    expect(fs.existsSync(path.join(tmpCwd, '.claude.json'))).toBe(false);
    const cfg = JSON.parse(fs.readFileSync(path.join(tmpCwd, '.mcp.json'), 'utf-8'));
    expect(cfg.mcpServers.specship).toBeDefined();
  });

  it('install does NOT write the legacy #529 MCP-playbook block into .claude/CLAUDE.md', () => {
    // --sdd so the project CLAUDE.md SDD rule is written, to assert it is the
    // ordering rule and NOT the #529 MCP playbook.
    claudeTarget.install('local', { autoAllow: false, sdd: true });
    // The legacy instructions path is never created…
    expect(fs.existsSync(path.join(tmpCwd, '.claude', 'CLAUDE.md'))).toBe(false);
    // …and the SDD rule that IS written (project-root CLAUDE.md) is the
    // ordering rule, NOT the MCP tool playbook #529 removed.
    const body = fs.readFileSync(path.join(tmpCwd, 'CLAUDE.md'), 'utf-8');
    expect(body).not.toContain('specship_search');
  });

  it('install strips a legacy CLAUDE.md specship block, keeping user content (#529)', () => {
    const legacy = path.join(tmpCwd, '.claude', 'CLAUDE.md');
    fs.mkdirSync(path.dirname(legacy), { recursive: true });
    fs.writeFileSync(legacy, `# My project rules\n\nUse tabs.\n\n${LEGACY_BLOCK}\n`);

    const result = claudeTarget.install('local', { autoAllow: false });

    const body = fs.readFileSync(legacy, 'utf-8');
    expect(body).toContain('# My project rules');
    expect(body).toContain('Use tabs.');
    expect(body).not.toContain('SPECSHIP_START');
    // Path-specific: there are now two CLAUDE.md entries in the report (the
    // stripped legacy one and the new project-root SDD rule). Match by suffix
    // since the recorded path is process.cwd()-resolved (/private/var on macOS).
    expect(result.files.find((f) => f.path.replace(/\\/g, '/').endsWith('/.claude/CLAUDE.md'))?.action).toBe('removed');
  });

  it('install --sdd writes the SDD rule into the project CLAUDE.md + a UserPromptSubmit nudge hook (REQ-SDD-001/002, opt-in per INSTALL-WEDGE-DOC)', () => {
    const result = claudeTarget.install('local', { autoAllow: false, sdd: true });

    const claudeMd = path.join(tmpCwd, 'CLAUDE.md');
    expect(fs.existsSync(claudeMd)).toBe(true);
    const body = fs.readFileSync(claudeMd, 'utf-8');
    expect(body).toContain('SPECSHIP_SDD_START');
    expect(body).toContain('spec-author');
    // The SDD block also steers claude.ai/design links to the design loop.
    expect(body).toContain('specship:design-loop');
    expect(body).toContain('claude.ai/design');
    expect(result.files.some((f) => /\/CLAUDE\.md$/.test(f.path.replace(/\\/g, '/')) && !f.path.includes('.claude') && f.action === 'created')).toBe(true);

    const settings = JSON.parse(fs.readFileSync(path.join(tmpCwd, '.claude', 'settings.json'), 'utf-8'));
    const cmds = (settings.hooks?.UserPromptSubmit ?? []).flatMap((g: any) => (g.hooks ?? []).map((h: any) => h.command));
    expect(cmds).toContain('specship spec-nudge');
  });

  it('default install provisions ONLY the retrieval tier — no governance commands, no SDD (REQ-WEDGE-001)', () => {
    claudeTarget.install('local', { autoAllow: false });
    const cmds = path.join(tmpCwd, '.claude', 'commands', 'specship');
    // Retrieval tier present — the reads door (under the /specship: namespace).
    expect(fs.existsSync(path.join(cmds, 'explore.md'))).toBe(true);
    // Governance tier absent (REQ-WEDGE-001.A2) — the intent + gate doors.
    for (const name of ['spec.md', 'check.md']) {
      expect(fs.existsSync(path.join(cmds, name))).toBe(false);
    }
    // SDD steering absent: no project CLAUDE.md, no spec-nudge hook.
    expect(fs.existsSync(path.join(tmpCwd, 'CLAUDE.md'))).toBe(false);
    const settingsPath = path.join(tmpCwd, '.claude', 'settings.json');
    if (fs.existsSync(settingsPath)) {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      const hookCmds = (settings.hooks?.UserPromptSubmit ?? []).flatMap((g: any) => (g.hooks ?? []).map((h: any) => h.command));
      expect(hookCmds).not.toContain('specship spec-nudge');
    }
  });

  it('install copies the specship-explorer subagent asset (INSTALL-BUNDLE-ASSETS REQ-001.A2)', () => {
    // The slash commands (asserted above) and this subagent are both copied via
    // packageAssetPath. In the bundled package only `dist/` ships, so the
    // resolver looks under `dist/` first (copy-assets stages the asset dirs
    // there) and falls back to the package/repo root. If the asset is missing
    // from where the resolver looks — the bundled-0.11.2 regression — the file
    // is never written and this fails (mirrors the install-time ENOENT).
    claudeTarget.install('local', { autoAllow: false });
    const agent = path.join(tmpCwd, '.claude', 'agents', 'specship-explorer.md');
    expect(fs.existsSync(agent)).toBe(true);
  });

  it('install --sdd adds the governance tier on top of retrieval (REQ-WEDGE-002.A1)', () => {
    claudeTarget.install('local', { autoAllow: false, sdd: true });
    const cmds = path.join(tmpCwd, '.claude', 'commands', 'specship');
    for (const name of ['explore.md', 'spec.md', 'check.md']) {
      expect(fs.existsSync(path.join(cmds, name))).toBe(true);
    }
    expect(fs.readFileSync(path.join(tmpCwd, 'CLAUDE.md'), 'utf-8')).toContain('SPECSHIP_SDD_START');
  });

  it('a default install AFTER a governance opt-in preserves the governance tier (REQ-WEDGE-002.A4)', () => {
    claudeTarget.install('local', { autoAllow: false, sdd: true });
    const govCmd = path.join(tmpCwd, '.claude', 'commands', 'specship', 'spec.md');
    expect(fs.existsSync(govCmd)).toBe(true);
    // A later plain install must not silently downgrade / strip governance.
    claudeTarget.install('local', { autoAllow: false });
    expect(fs.existsSync(govCmd)).toBe(true);
    expect(fs.readFileSync(path.join(tmpCwd, 'CLAUDE.md'), 'utf-8')).toContain('SPECSHIP_SDD_START');
  });

  it('install with sdd:false writes neither the CLAUDE.md rule nor the nudge hook (REQ-SDD-003)', () => {
    claudeTarget.install('local', { autoAllow: false, sdd: false });
    expect(fs.existsSync(path.join(tmpCwd, 'CLAUDE.md'))).toBe(false);
    const settingsPath = path.join(tmpCwd, '.claude', 'settings.json');
    if (fs.existsSync(settingsPath)) {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      const cmds = (settings.hooks?.UserPromptSubmit ?? []).flatMap((g: any) => (g.hooks ?? []).map((h: any) => h.command));
      expect(cmds).not.toContain('specship spec-nudge');
    }
  });

  it('SDD install is idempotent — CLAUDE.md rule unchanged on re-run (REQ-SDD-001.A3)', () => {
    claudeTarget.install('local', { autoAllow: true, sdd: true });
    const second = claudeTarget.install('local', { autoAllow: true, sdd: true });
    expect(second.files.find((f) => /\/CLAUDE\.md$/.test(f.path.replace(/\\/g, '/')) && !f.path.includes('.claude'))?.action).toBe('unchanged');
  });

  it('uninstall removes the SDD rule block and the nudge hook (REQ-SDD-003.A3)', () => {
    claudeTarget.install('local', { autoAllow: true, sdd: true });
    const claudeMd = path.join(tmpCwd, 'CLAUDE.md');
    expect(fs.existsSync(claudeMd)).toBe(true);

    claudeTarget.uninstall('local');

    if (fs.existsSync(claudeMd)) {
      expect(fs.readFileSync(claudeMd, 'utf-8')).not.toContain('SPECSHIP_SDD_START');
    }
    const settingsPath = path.join(tmpCwd, '.claude', 'settings.json');
    if (fs.existsSync(settingsPath)) {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      const cmds = (settings.hooks?.UserPromptSubmit ?? []).flatMap((g: any) => (g.hooks ?? []).map((h: any) => h.command));
      expect(cmds).not.toContain('specship spec-nudge');
    }
  });

  it('uninstall preserves the user CLAUDE.md content outside the SDD markers', () => {
    const claudeMd = path.join(tmpCwd, 'CLAUDE.md');
    fs.writeFileSync(claudeMd, '# My rules\n\nUse 4 spaces.\n');
    claudeTarget.install('local', { autoAllow: true });
    claudeTarget.uninstall('local');
    const body = fs.readFileSync(claudeMd, 'utf-8');
    expect(body).toContain('# My rules');
    expect(body).toContain('Use 4 spaces.');
    expect(body).not.toContain('SPECSHIP_SDD_START');
  });

  it('global install targets ~/.claude.json (user scope)', () => {
    claudeTarget.install('global', { autoAllow: false });
    const cfg = JSON.parse(fs.readFileSync(path.join(tmpHome, '.claude.json'), 'utf-8'));
    expect(cfg.mcpServers.specship).toBeDefined();
  });

  it('local install migrates a legacy ./.claude.json specship entry into ./.mcp.json', () => {
    const legacy = path.join(tmpCwd, '.claude.json');
    fs.writeFileSync(
      legacy,
      JSON.stringify({ mcpServers: { specship: { type: 'stdio', command: 'specship', args: ['serve', '--mcp'] } } }, null, 2),
    );

    claudeTarget.install('local', { autoAllow: false });

    const mcp = JSON.parse(fs.readFileSync(path.join(tmpCwd, '.mcp.json'), 'utf-8'));
    expect(mcp.mcpServers.specship).toBeDefined();
    expect(fs.existsSync(legacy)).toBe(false);
  });

  it('legacy ./.claude.json migration preserves sibling servers and unrelated keys', () => {
    const legacy = path.join(tmpCwd, '.claude.json');
    fs.writeFileSync(
      legacy,
      JSON.stringify({
        mcpServers: {
          specship: { type: 'stdio', command: 'specship', args: ['serve', '--mcp'] },
          other: { command: 'x' },
        },
        somethingElse: true,
      }, null, 2),
    );

    claudeTarget.install('local', { autoAllow: false });

    const after = JSON.parse(fs.readFileSync(legacy, 'utf-8'));
    expect(after.mcpServers.specship).toBeUndefined();
    expect(after.mcpServers.other).toBeDefined();
    expect(after.somethingElse).toBe(true);
    const mcp = JSON.parse(fs.readFileSync(path.join(tmpCwd, '.mcp.json'), 'utf-8'));
    expect(mcp.mcpServers.specship).toBeDefined();
  });

  it('uninstall strips specship from ./.mcp.json and a legacy ./.claude.json', () => {
    fs.writeFileSync(
      path.join(tmpCwd, '.mcp.json'),
      JSON.stringify({ mcpServers: { specship: { command: 'specship' } } }, null, 2),
    );
    fs.writeFileSync(
      path.join(tmpCwd, '.claude.json'),
      JSON.stringify({ mcpServers: { specship: { command: 'specship' }, other: { command: 'x' } } }, null, 2),
    );

    claudeTarget.uninstall('local');

    const mcp = JSON.parse(fs.readFileSync(path.join(tmpCwd, '.mcp.json'), 'utf-8'));
    expect(mcp.mcpServers).toBeUndefined();
    const legacy = JSON.parse(fs.readFileSync(path.join(tmpCwd, '.claude.json'), 'utf-8'));
    expect(legacy.mcpServers.specship).toBeUndefined();
    expect(legacy.mcpServers.other).toBeDefined();
  });

  // ---- Legacy auto-sync hook cleanup ----
  // Pre-0.8 installs wrote `specship mark-dirty` / `sync-if-dirty`
  // hooks to settings.json. Both subcommands were removed from the CLI,
  // so the Stop hook fails every turn ("unknown command
  // 'sync-if-dirty'"). The installer must strip them on upgrade and
  // uninstall — without touching the user's unrelated hooks.

  function seedSettings(loc: 'global' | 'local', settings: Record<string, any>): string {
    const dir = path.join(loc === 'global' ? tmpHome : tmpCwd, '.claude');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'settings.json');
    fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
    return file;
  }

  function legacyHookSettings(): Record<string, any> {
    return {
      hooks: {
        PostToolUse: [
          { matcher: 'Edit|Write', hooks: [{ type: 'command', command: 'specship mark-dirty', async: true }] },
        ],
        Stop: [
          { hooks: [{ type: 'command', command: 'specship sync-if-dirty' }] },
          { hooks: [{ type: 'command', command: '"/Users/me/gk" ai hook run --host claude-code' }] },
        ],
      },
    };
  }

  it("install strips stale specship auto-sync hooks but keeps the user's GitKraken hook (and writes the current sync hooks)", () => {
    const file = seedSettings('global', legacyHookSettings());

    claudeTarget.install('global', { autoAllow: true });

    const after = JSON.parse(fs.readFileSync(file, 'utf-8'));

    // Legacy mark-dirty is gone — its PostToolUse group was the only
    // one before install. Install then writes its OWN PostToolUse
    // hook (matcher='Edit|Write|MultiEdit') for the current
    // `specship sync --quiet` form, so PostToolUse is defined now,
    // just with the new entry instead of the legacy mark-dirty one.
    const postCommands = (after.hooks?.PostToolUse ?? []).flatMap((g: any) =>
      (g.hooks ?? []).map((h: any) => h.command),
    );
    expect(postCommands).not.toContain('specship mark-dirty');
    expect(postCommands).toContain('specship sync --quiet');

    // Legacy sync-if-dirty is gone from Stop; the user's GitKraken
    // hook (unrelated) survives.
    const stopCommands = (after.hooks?.Stop ?? []).flatMap((g: any) =>
      (g.hooks ?? []).map((h: any) => h.command),
    );
    expect(stopCommands).not.toContain('specship sync-if-dirty');
    expect(stopCommands.some((c: string) => c.includes('gk') && c.includes('ai hook run'))).toBe(true);

    // SessionStart sync hook is added too.
    const sessionCommands = (after.hooks?.SessionStart ?? []).flatMap((g: any) =>
      (g.hooks ?? []).map((h: any) => h.command),
    );
    expect(sessionCommands).toContain('specship sync --quiet');

    expect(after.permissions?.allow).toContain('mcp__specship__specship_search');
    // Harness read tools are auto-allowed too (MAINT-DOC / FITNESS-DOC).
    expect(after.permissions?.allow).toContain('mcp__specship__specship_maintainability');
    expect(after.permissions?.allow).toContain('mcp__specship__specship_fitness');
  });

  it('cleanupLegacyHooks preserves a sibling hook sharing our matcher group', () => {
    const file = seedSettings('global', {
      hooks: {
        Stop: [
          {
            hooks: [
              { type: 'command', command: 'specship sync-if-dirty' },
              { type: 'command', command: 'gk ai hook run --host claude-code' },
            ],
          },
        ],
      },
    });

    expect(cleanupLegacyHooks('global').action).toBe('removed');

    const after = JSON.parse(fs.readFileSync(file, 'utf-8'));
    expect(after.hooks.Stop[0].hooks.map((h: any) => h.command)).toEqual([
      'gk ai hook run --host claude-code',
    ]);
  });

  it('cleanupLegacyHooks is a byte-for-byte no-op without specship hooks', () => {
    const original =
      JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'gk ai hook run' }] }] } }, null, 2) + '\n';
    const file = seedSettings('global', JSON.parse(original));

    expect(cleanupLegacyHooks('global').action).toBe('unchanged');
    expect(fs.readFileSync(file, 'utf-8')).toBe(original);
  });

  it('cleanupLegacyHooks reports not-found when settings.json is absent', () => {
    expect(cleanupLegacyHooks('global').action).toBe('not-found');
  });

  it('re-running install after a legacy cleanup leaves settings.json unchanged', () => {
    const file = seedSettings('global', legacyHookSettings());
    claudeTarget.install('global', { autoAllow: true });
    const firstPass = fs.readFileSync(file, 'utf-8');
    claudeTarget.install('global', { autoAllow: true });
    expect(fs.readFileSync(file, 'utf-8')).toBe(firstPass);
  });

  it('uninstall strips stale hooks written in the npx form (local)', () => {
    const file = seedSettings('local', {
      hooks: {
        PostToolUse: [
          { matcher: 'Edit|Write', hooks: [{ type: 'command', command: 'npx @specship/specship mark-dirty', async: true }] },
        ],
        Stop: [
          { hooks: [{ type: 'command', command: 'npx @specship/specship sync-if-dirty' }] },
        ],
      },
    });

    claudeTarget.uninstall('local');

    const after = JSON.parse(fs.readFileSync(file, 'utf-8'));
    expect(after.hooks).toBeUndefined();
  });

  // ---- New (current-release) hooks + commands + subagent ----

  it('install writes PostToolUse and SessionStart sync hooks when autoAllow is on', () => {
    const file = path.join(tmpHome, '.claude', 'settings.json');
    claudeTarget.install('global', { autoAllow: true });

    const settings = JSON.parse(fs.readFileSync(file, 'utf-8'));
    const postHooks = settings.hooks?.PostToolUse?.find((g: any) => g.matcher === 'Edit|Write|MultiEdit')?.hooks ?? [];
    expect(postHooks.find((h: any) => h.command === 'specship sync --quiet')?.async).toBe(true);
    const sessionHooks = settings.hooks?.SessionStart?.find((g: any) => g.matcher === 'startup|resume')?.hooks ?? [];
    expect(sessionHooks.some((h: any) => h.command === 'specship sync --quiet')).toBe(true);
    expect(sessionHooks[0]?.async).toBeUndefined(); // SessionStart is sync
  });

  it('install does NOT write sync hooks when autoAllow is off', () => {
    const settingsPath = path.join(tmpHome, '.claude', 'settings.json');
    claudeTarget.install('global', { autoAllow: false });

    if (fs.existsSync(settingsPath)) {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      // autoAllow off ⇒ no auto-sync hooks. The SDD nudge hook is gated on
      // `sdd` (on by default), not autoAllow, so it MAY be present — assert
      // only that the auto-sync command is absent.
      const allCommands = Object.values(settings.hooks ?? {}).flatMap((groups: any) =>
        (groups as any[]).flatMap((g) => (g.hooks ?? []).map((h: any) => h.command)),
      );
      expect(allCommands).not.toContain('specship sync --quiet');
    }
  });

  it('install --sdd copies the full shipped door set and subagent', () => {
    claudeTarget.install('global', { autoAllow: false, sdd: true });

    for (const name of ['explore.md', 'spec.md', 'check.md']) {
      expect(fs.existsSync(path.join(tmpHome, '.claude', 'commands', 'specship', name))).toBe(true);
    }
    expect(fs.existsSync(path.join(tmpHome, '.claude', 'agents', 'specship-explorer.md'))).toBe(true);

    // Spot-check the subagent body has the expected restricted-tools allowlist.
    const explorer = fs.readFileSync(path.join(tmpHome, '.claude', 'agents', 'specship-explorer.md'), 'utf-8');
    expect(explorer).toContain('name: specship-explorer');
    expect(explorer).toMatch(/tools:\s*mcp__specship__/);
  });

  it('install preserves a user-written sibling command in the same dir', () => {
    const userCmd = path.join(tmpHome, '.claude', 'commands', 'my-cmd.md');
    fs.mkdirSync(path.dirname(userCmd), { recursive: true });
    fs.writeFileSync(userCmd, '---\ndescription: mine\n---\nHello\n');

    claudeTarget.install('global', { autoAllow: false });

    expect(fs.readFileSync(userCmd, 'utf-8')).toBe('---\ndescription: mine\n---\nHello\n');
    expect(fs.existsSync(path.join(tmpHome, '.claude', 'commands', 'specship', 'explore.md'))).toBe(true);
  });

  it('install removes superseded commands (legacy cg-* and the per-action ss-* folded into doors)', () => {
    // Simulate an older install: the pre-v0.2 cg-* set AND the per-action ss-*
    // commands that WORKFLOW-DOORS-DOC folded into the explore/spec/check doors,
    // alongside an unrelated user file.
    const cmdsDir = path.join(tmpHome, '.claude', 'commands');
    fs.mkdirSync(cmdsDir, { recursive: true });
    const supersededNames = ['cg-sync.md', 'cg-trace.md', 'ss-trace.md', 'ss-implement.md', 'ss-brainstorm.md', 'ss-triage.md', 'ss-fix.md'];
    for (const name of supersededNames) {
      fs.writeFileSync(path.join(cmdsDir, name), '# from an older installer\n');
    }
    const siblingUser = path.join(cmdsDir, 'my-helper.md');
    fs.writeFileSync(siblingUser, '# user file');

    claudeTarget.install('global', { autoAllow: false, sdd: true });

    // Every superseded shipped file is gone — self-healed on upgrade (REQ-DOORS-003.A1).
    for (const name of supersededNames) {
      expect(fs.existsSync(path.join(cmdsDir, name))).toBe(false);
    }
    // The surviving doors exist under the /specship: namespace.
    expect(fs.existsSync(path.join(cmdsDir, 'specship', 'explore.md'))).toBe(true);
    expect(fs.existsSync(path.join(cmdsDir, 'specship', 'spec.md'))).toBe(true);
    expect(fs.existsSync(path.join(cmdsDir, 'specship', 'check.md'))).toBe(true);
    // The user's own file is untouched.
    expect(fs.readFileSync(siblingUser, 'utf-8')).toBe('# user file');
  });

  it('upgrade removes the flat /ss-* door commands and keeps only the namespaced ones (CMD-NS-DOC, REQ-CMD-NS-003)', () => {
    // Simulate a pre-rename install: the flat door files at the top level.
    const cmdsDir = path.join(tmpHome, '.claude', 'commands');
    fs.mkdirSync(cmdsDir, { recursive: true });
    const flatDoors = ['ss-explore.md', 'ss-spec.md', 'ss-check.md', 'ss-design-implement.md', 'ss-design-loop.md'];
    for (const name of flatDoors) fs.writeFileSync(path.join(cmdsDir, name), '# older flat door\n');
    const siblingUser = path.join(cmdsDir, 'my-notes.md');
    fs.writeFileSync(siblingUser, '# user file');

    claudeTarget.install('global', { autoAllow: false, sdd: true });

    // A1: all five flat door files are gone.
    for (const name of flatDoors) {
      expect(fs.existsSync(path.join(cmdsDir, name))).toBe(false);
    }
    // A2: the only shipped doors present are the namespaced ones.
    for (const name of ['explore.md', 'spec.md', 'check.md', 'design-implement.md', 'design-loop.md']) {
      expect(fs.existsSync(path.join(cmdsDir, 'specship', name))).toBe(true);
    }
    // A3: an unrelated user file is not removed by the cleanup.
    expect(fs.readFileSync(siblingUser, 'utf-8')).toBe('# user file');
  });

  it('install surfaces a one-time rename notice only when it migrates off the flat commands (CMD-NS-DOC, REQ-CMD-NS-004)', () => {
    const cmdsDir = path.join(tmpHome, '.claude', 'commands');

    // A2: a fresh install (no flat commands present) shows no rename notice.
    const fresh = claudeTarget.install('global', { autoAllow: false, sdd: true });
    expect((fresh.notes ?? []).some((n) => /specship:/.test(n) && /ss-/.test(n))).toBe(false);

    // Now plant a flat door file and re-install → the migration notice appears.
    fs.writeFileSync(path.join(cmdsDir, 'ss-spec.md'), '# older flat door\n');
    const migrated = claudeTarget.install('global', { autoAllow: false, sdd: true });
    // A1: the notice names both the old (/ss-*) and new (/specship:*) forms.
    const notice = (migrated.notes ?? []).find((n) => /\/specship:/.test(n) && /\/ss-/.test(n));
    expect(notice).toBeDefined();
  });

  it('uninstall removes the shipped doors + subagent + current-release hooks', () => {
    claudeTarget.install('global', { autoAllow: true, sdd: true });
    expect(fs.existsSync(path.join(tmpHome, '.claude', 'commands', 'specship', 'explore.md'))).toBe(true);
    expect(fs.existsSync(path.join(tmpHome, '.claude', 'agents', 'specship-explorer.md'))).toBe(true);

    claudeTarget.uninstall('global');

    for (const name of ['explore.md', 'spec.md', 'check.md']) {
      expect(fs.existsSync(path.join(tmpHome, '.claude', 'commands', 'specship', name))).toBe(false);
    }
    expect(fs.existsSync(path.join(tmpHome, '.claude', 'agents', 'specship-explorer.md'))).toBe(false);

    // hooks block is gone (nothing else was using it).
    const settings = JSON.parse(fs.readFileSync(path.join(tmpHome, '.claude', 'settings.json'), 'utf-8'));
    expect(settings.hooks).toBeUndefined();
  });

  it('uninstall preserves a user-written sibling command in the same dir', () => {
    claudeTarget.install('global', { autoAllow: false });
    const userCmd = path.join(tmpHome, '.claude', 'commands', 'my-cmd.md');
    fs.writeFileSync(userCmd, '---\ndescription: mine\n---\nHello\n');

    claudeTarget.uninstall('global');

    expect(fs.readFileSync(userCmd, 'utf-8')).toBe('---\ndescription: mine\n---\nHello\n');
  });

  it('uninstall preserves a user file placed inside the specship/ subdir (CMD-NS-DOC, REQ-CMD-NS-002.A2)', () => {
    claudeTarget.install('global', { autoAllow: false, sdd: true });
    const nsDir = path.join(tmpHome, '.claude', 'commands', 'specship');
    const userInNs = path.join(nsDir, 'my-own.md');
    fs.writeFileSync(userInNs, '# mine, inside the namespace dir');

    claudeTarget.uninstall('global');

    // Our shipped files are gone, but the user's file — and thus the dir — remain.
    expect(fs.existsSync(path.join(nsDir, 'spec.md'))).toBe(false);
    expect(fs.readFileSync(userInNs, 'utf-8')).toBe('# mine, inside the namespace dir');
  });

  it('cleanupCurrentHooks strips specship sync hooks without touching unrelated user hooks', () => {
    const file = seedSettings('global', {
      hooks: {
        PostToolUse: [
          {
            matcher: 'Edit|Write|MultiEdit',
            hooks: [
              { type: 'command', command: 'specship sync --quiet', async: true },
              { type: 'command', command: 'echo hello' },
            ],
          },
        ],
      },
    });

    expect(cleanupCurrentHooks('global').action).toBe('removed');

    const after = JSON.parse(fs.readFileSync(file, 'utf-8'));
    expect(after.hooks.PostToolUse[0].hooks.map((h: any) => h.command)).toEqual(['echo hello']);
  });
});

describe('Installer targets — registry', () => {
  it('getTarget returns the Claude target by id', () => {
    expect(getTarget('claude')?.id).toBe('claude');
    expect(getTarget('not-a-real-target')).toBeUndefined();
  });

  it('ALL_TARGETS contains exactly the Claude target', () => {
    expect(ALL_TARGETS.length).toBe(1);
    expect(ALL_TARGETS[0]?.id).toBe('claude');
  });

  it('uninstallTargets reports not-configured when nothing was installed', () => {
    const reports = uninstallTargets([claudeTarget], 'global');
    expect(reports.length).toBe(1);
    expect(reports[0]?.status).toBe('not-configured');
  });
});

/**
 * Status-line opt-in (SHIP-STATUSLINE-DOC, REQ-STATUSLINE-006/007). The segment
 * is wired only when the caller opts in, and NEVER clobbers a status line the
 * user already configured.
 */
describe('Claude target — status-line opt-in', () => {
  let tmpHome: string;
  let tmpCwd: string;
  let origCwd: string;
  let homeRestore: { restore: () => void };

  const settingsPath = () => path.join(tmpCwd, '.claude', 'settings.json');
  const readSettings = () => JSON.parse(fs.readFileSync(settingsPath(), 'utf-8'));
  const writeSettings = (obj: unknown) => {
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
    fs.writeFileSync(settingsPath(), JSON.stringify(obj, null, 2) + '\n');
  };

  beforeEach(() => {
    tmpHome = mkTmpDir('home');
    tmpCwd = mkTmpDir('cwd');
    origCwd = process.cwd();
    process.chdir(tmpCwd);
    homeRestore = setHome(tmpHome);
  });
  afterEach(() => {
    homeRestore.restore();
    process.chdir(origCwd);
    fs.rmSync(tmpHome, { recursive: true, force: true });
    fs.rmSync(tmpCwd, { recursive: true, force: true });
  });

  it('default install writes NO status line (opt-in only)', () => {
    claudeTarget.install('local', { autoAllow: false });
    // A retrieval-only default install (no autoAllow, no --sdd) may write no
    // settings.json at all; a status line is absent either way.
    const settings = fs.existsSync(settingsPath()) ? readSettings() : {};
    expect(settings.statusLine).toBeUndefined();
  });

  it('opt-in install writes a marked statusLine invoking `specship statusline` (REQ-006.A1)', () => {
    const result = claudeTarget.install('local', { autoAllow: false, installStatusLine: true });
    const settings = readSettings();
    expect(settings.statusLine).toBeDefined();
    expect(settings.statusLine.type).toBe('command');
    expect(settings.statusLine.command).toContain('specship statusline');
    expect(settings.statusLine._specship).toBe(true);
    // It is reported in the install file list.
    expect(result.files.some((f) => f.path.replace(/\\/g, '/').endsWith('/.claude/settings.json'))).toBe(true);
  });

  it('opt-in install NEVER overwrites a user-authored status line, and surfaces the snippet (REQ-006.A2)', () => {
    writeSettings({ statusLine: { type: 'command', command: 'my-own-statusline.sh' } });

    const result = claudeTarget.install('local', { autoAllow: false, installStatusLine: true });

    const settings = readSettings();
    expect(settings.statusLine.command).toBe('my-own-statusline.sh');
    expect(settings.statusLine._specship).toBeUndefined();
    const slEntry = result.files.find((f) => f.action === 'kept');
    expect(slEntry).toBeDefined();
    expect((result.notes ?? []).join('\n')).toContain('specship statusline');
  });

  it('re-running opt-in install is idempotent for the status line (REQ-006.A4)', () => {
    claudeTarget.install('local', { autoAllow: false, installStatusLine: true });
    const second = writeStatusLineEntry('local');
    expect(second.action).toBe('unchanged');
  });

  it('uninstall removes the marked status line we wrote (REQ-007.A1)', () => {
    claudeTarget.install('local', { autoAllow: false, installStatusLine: true });
    expect(readSettings().statusLine).toBeDefined();

    claudeTarget.uninstall('local');
    expect(readSettings().statusLine).toBeUndefined();
  });

  it('uninstall leaves a user-authored status line untouched (REQ-007.A2)', () => {
    writeSettings({ statusLine: { type: 'command', command: 'my-own-statusline.sh' } });
    claudeTarget.uninstall('local');
    expect(readSettings().statusLine.command).toBe('my-own-statusline.sh');
  });

  it('statusLineState classifies none / ours / foreign', () => {
    expect(statusLineState('local')).toBe('none');
    writeSettings({ statusLine: { type: 'command', command: 'whatever' } });
    expect(statusLineState('local')).toBe('foreign');
    removeStatusLineEntry('local'); // no-op on a foreign line
    expect(statusLineState('local')).toBe('foreign');
    writeStatusLineEntry('local'); // refuses to clobber foreign → still foreign
    expect(statusLineState('local')).toBe('foreign');
  });

  it('writeStatusLineEntry on a clean config yields ours', () => {
    writeStatusLineEntry('local');
    expect(statusLineState('local')).toBe('ours');
  });
});
