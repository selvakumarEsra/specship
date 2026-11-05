import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import ts from 'typescript';
import {
  HOST_LITERALS,
  checkAllowlist,
  scanHostLiterals,
} from './helpers/host-literal-scan';
import { HOST_LITERAL_ALLOWLIST } from './fixtures/host-literal-allowlist';
import {
  ALL_HOST_TRAITS,
  CLAUDE_CODE_TRAITS,
  DEFAULT_HOST_TRAITS,
  GEMINI_CLI_TRAITS,
  hostTraitsFor,
} from '../src/activation/hook-output';
import { buildSteeringNudge, STEERING_TEXT } from '../src/activation/steering';
import { buildSearchIntercept } from '../src/activation/search-intercept';
import { claudeTarget } from '../src/installer/targets/claude';
import { geminiTarget } from '../src/installer/targets/gemini';
import { withAgentVariables } from '../src/workflows/executor';
import { collectMemoryFiles } from '../server/src/routes/memory';
import { configuredServers, setServerEnabled, McpConfigError } from '../server/src/routes/mcp';
import { CLAUDE_PROFILE, GEMINI_PROFILE } from '../server/src/host-profiles';

/**
 * AGENTSWITCH-DOC, REQ-AGENTSWITCH-001 — host facts come from one per-agent
 * profile. The guard scans shared code for host literals; the rest pins the
 * fixed leaks and the required-profile signatures.
 */

const REPO = path.resolve(__dirname, '..');

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentswitch-001-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('REQ-AGENTSWITCH-001 — host facts come from one per-agent profile', () => {
  it('REQ-AGENTSWITCH-001.A1 — the source scan flags a host literal in shared code and the real tree is clean', reqAgentswitch001A1);
  function reqAgentswitch001A1(): void {
    // A planted literal in shared code is flagged; the same literal in a
    // comment, in an adapter directory or in a non-shared root is not.
    const write = (rel: string, body: string) => {
      fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true });
      fs.writeFileSync(path.join(tmp, rel), body);
    };
    write('src/engine/leak.ts', "export const memory = 'CLAUDE.md';\n// a comment naming GEMINI.md\n");
    write('server/src/routes/leak.ts', "const f = '~/.claude.json';\n");
    write('src/workflows/defaults/w.yaml', "steps:\n  # BeforeAgent in a comment\n  - prompt: read .gemini/settings.json\n");
    write('src/installer/targets/claude.ts', "export const e = 'UserPromptSubmit';\n");
    write('src/workflows/agents/claude.ts', "export const t = 'mcp__specship__x';\n");
    write('scripts/outside.ts', "export const e = 'BeforeAgent';\n");
    const hits = scanHostLiterals(tmp);
    expect(hits).toEqual([
      { file: 'server/src/routes/leak.ts', literal: '~/.claude.json', line: 1 },
      { file: 'server/src/routes/leak.ts', literal: '.claude.json', line: 1 },
      { file: 'src/engine/leak.ts', literal: 'CLAUDE.md', line: 1 },
      { file: 'src/workflows/defaults/w.yaml', literal: '.gemini/', line: 3 },
    ]);
    // Every literal the criterion names is one the scan looks for.
    for (const lit of ['mcp__specship__', '.claude/', '.gemini/', 'CLAUDE.md', 'GEMINI.md', 'UserPromptSubmit', 'BeforeAgent', '~/.claude.json']) {
      expect(HOST_LITERALS).toContain(lit);
    }
    // An unlisted hit fails the check.
    expect(checkAllowlist(hits, []).unlisted).toHaveLength(4);

    // The real tree: every hit is on the allowlist, and no entry is stale.
    const real = checkAllowlist(scanHostLiterals(REPO), HOST_LITERAL_ALLOWLIST);
    expect(real.unlisted).toEqual([]);
    expect(real.stale).toEqual([]);
    // Each entry pins its count: a new occurrence in a listed file fails.
    expect(real.miscounted.map(({ entry, actual }) => `${entry.file} ${entry.literal}: listed ${entry.count}, found ${actual}`)).toEqual([]);
    const entry = { file: 'src/x.ts', literal: 'CLAUDE.md', count: 1, reason: 'synthetic entry for the count check' };
    const twice = [{ file: entry.file, literal: entry.literal, line: 1 }, { file: entry.file, literal: entry.literal, line: 2 }];
    expect(checkAllowlist(twice, [entry]).miscounted).toHaveLength(1);
    // Shared code carries no host literal at all: the allowlist is empty.
    expect(HOST_LITERAL_ALLOWLIST).toEqual([]);
  }

  it('REQ-AGENTSWITCH-019.A5 — the guard also catches hook events, edit matchers, MCP name forms and user config files', reqAgentswitch019A5);
  function reqAgentswitch019A5(): void {
    const leaks = [
      "const e = 'PostToolUse';",
      "const m = 'Edit|Write';",
      "const t = 'mcp_specship_' + name;",
      "const q = `specship__${name}`;",
      "const f = path.join(home, '.claude.json');",
    ];
    fs.mkdirSync(path.join(tmp, 'src', 'reflect'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src', 'reflect', 'leak.ts'), leaks.join('\n') + '\n');
    const lines = new Set(scanHostLiterals(tmp).map((h) => h.line));
    expect([...lines].sort()).toEqual([1, 2, 3, 4, 5]);
    // The current tree passes with an empty allowlist.
    expect(checkAllowlist(scanHostLiterals(REPO), []).unlisted).toEqual([]);
  }

  it('REQ-AGENTSWITCH-001.A2 — the listed leaks are fixed and every remaining literal has a reason', reqAgentswitch001A2);
  async function reqAgentswitch001A2(): Promise<void> {
    // Every allowlist entry carries a one-line reason and is unique.
    const keys = new Set<string>();
    for (const e of HOST_LITERAL_ALLOWLIST) {
      expect(e.reason.trim().length, `${e.file} ${e.literal}`).toBeGreaterThan(10);
      expect(e.reason).not.toContain('\n');
      const k = `${e.file}|${e.literal}`;
      expect(keys.has(k), k).toBe(false);
      keys.add(k);
    }
    // The fixed leaks are not on the allowlist.
    for (const fixed of ['server/src/routes/memory.ts', 'server/src/routes/mcp.ts', 'src/workflows/defaults/claude-design-implement.yaml']) {
      const listed = HOST_LITERAL_ALLOWLIST.filter((e) => e.file === fixed && e.literal !== 'mcp__specship__');
      expect(listed, fixed).toEqual([]);
    }

    // The bundled design workflow names the run's agent's skills dir.
    const design = fs.readFileSync(path.join(REPO, 'src/workflows/defaults/claude-design-implement.yaml'), 'utf8');
    expect(design).toContain('$AGENT_SKILLS_DIR/design-md/SKILL.md');
    expect(design).toContain('$AGENT_SKILLS_DIR/spec-author/SKILL.md');
    expect(withAgentVariables(undefined, 'gemini').AGENT_SKILLS_DIR).toBe('~/.gemini/skills');
    expect(withAgentVariables(undefined, undefined).AGENT_SKILLS_DIR).toBe('~/.claude/skills');
    expect(withAgentVariables({ AGENT_SKILLS_DIR: '/x' }, 'gemini').AGENT_SKILLS_DIR).toBe('/x');

    // The dashboard's memory view lists both agents' files (temp HOME).
    const home = path.join(tmp, 'home');
    const proj = path.join(tmp, 'proj');
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
    fs.mkdirSync(path.join(home, '.gemini'), { recursive: true });
    fs.mkdirSync(path.join(proj, 'pkg'), { recursive: true });
    fs.writeFileSync(path.join(home, '.claude', 'CLAUDE.md'), 'claude user\n');
    fs.writeFileSync(path.join(home, '.gemini', 'GEMINI.md'), 'gemini user\n');
    fs.writeFileSync(path.join(proj, 'CLAUDE.md'), 'claude project\n');
    fs.writeFileSync(path.join(proj, 'GEMINI.md'), 'gemini project\n');
    fs.writeFileSync(path.join(proj, 'pkg', 'GEMINI.md'), 'gemini nested\n');
    const prevHome = process.env.HOME;
    process.env.HOME = home;
    try {
      const files = await collectMemoryFiles(proj);
      const brief = files.map((f) => [f.id, f.level, f.name, f.host]);
      expect(brief).toEqual([
        ['m-user', 'user', 'CLAUDE.md', 'claude'],
        ['m-user-gemini', 'user', 'GEMINI.md', 'gemini'],
        ['m-proj', 'project', 'CLAUDE.md', 'claude'],
        ['m-proj-gemini', 'project', 'GEMINI.md', 'gemini'],
        ['m-sub-pkg-gemini', 'subdir', 'GEMINI.md', 'gemini'],
      ]);
      expect(files.find((f) => f.id === 'm-user-gemini')?.scope).toBe('~/.gemini');
    } finally {
      process.env.HOME = prevHome;
    }

    // The dashboard's MCP view reads Gemini's user and project settings.
    const claudeJsonPath = path.join(home, '.claude.json');
    fs.writeFileSync(claudeJsonPath, JSON.stringify({ mcpServers: { specship: { command: 'specship' } } }));
    fs.writeFileSync(path.join(home, '.gemini', 'settings.json'), JSON.stringify({ mcpServers: { specship: { command: 'specship' }, other: { url: 'http://x' } } }));
    fs.mkdirSync(path.join(proj, '.gemini'), { recursive: true });
    fs.writeFileSync(path.join(proj, '.gemini', 'settings.json'), JSON.stringify({ mcpServers: { local: { command: 'l' } } }));
    const paths = { claudeJsonPath, projectRoot: proj, geminiSettingsPath: path.join(home, '.gemini', 'settings.json') };
    const servers = configuredServers(paths);
    expect([...servers.entries()].map(([k, s]) => [k, s.name, s.host, s.scope])).toEqual([
      ['specship', 'specship', 'claude', 'user'],
      ['gemini:specship', 'specship', 'gemini', 'user'],
      ['gemini:other', 'other', 'gemini', 'user'],
      ['gemini:local', 'local', 'gemini', 'project'],
    ]);
    // Gemini entries are listed, not edited, from the dashboard.
    expect(() => setServerEnabled(paths, 'gemini:other', false)).toThrow(McpConfigError);
    // Without a Gemini path the inventory is Claude Code's alone, as before.
    expect([...configuredServers({ claudeJsonPath, projectRoot: proj }).keys()]).toEqual(['specship']);

    // The server's profiles mirror the core profiles.
    for (const [server, core] of [[CLAUDE_PROFILE, CLAUDE_CODE_TRAITS], [GEMINI_PROFILE, GEMINI_CLI_TRAITS]] as const) {
      expect([server.id, server.displayName, server.memoryFile, server.configDir, server.userConfigFile])
        .toEqual([core.id, core.displayName, core.memoryFile, core.configDir, core.userConfigFile]);
    }
  }

  it('REQ-AGENTSWITCH-001.A3 — steering and search interception require the host profile; a call without one does not compile', reqAgentswitch001A3);
  function reqAgentswitch001A3(): void {
    const steering = path.join(REPO, 'src/activation/steering').split(path.sep).join('/');
    const intercept = path.join(REPO, 'src/activation/search-intercept').split(path.sep).join('/');
    const hookOutput = path.join(REPO, 'src/activation/hook-output').split(path.sep).join('/');
    const probe = path.join(tmp, 'probe.ts');
    const lines = [
      `import { buildSteeringNudge, renderSteering } from '${steering}';`,
      `import { buildSearchIntercept } from '${intercept}';`,
      `import { DEFAULT_HOST_TRAITS } from '${hookOutput}';`,
      `buildSteeringNudge('/p', DEFAULT_HOST_TRAITS, {});`, // 4: ok
      `buildSearchIntercept({ cwd: '/p', sessionId: null, transcriptPath: null, traits: DEFAULT_HOST_TRAITS });`, // 5: ok
      `renderSteering('{explore}', DEFAULT_HOST_TRAITS);`, // 6: ok
      `buildSteeringNudge('/p');`, // 7: missing profile
      `buildSearchIntercept({ cwd: '/p', sessionId: null, transcriptPath: null });`, // 8: missing profile
      `renderSteering('{explore}', 'mcp__x__');`, // 9: a prefix is not a profile
    ];
    fs.writeFileSync(probe, lines.join('\n') + '\n');
    const program = ts.createProgram([probe], {
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      esModuleInterop: true,
      types: ['node'],
      typeRoots: [path.join(REPO, 'node_modules', '@types')],
    });
    const diags = ts.getPreEmitDiagnostics(program, program.getSourceFile(probe));
    const errorLines = [...new Set(diags.map((d) => d.file!.getLineAndCharacterOfPosition(d.start!).line + 1))].sort();
    expect(errorLines).toEqual([7, 8, 9]);

    // Runtime: each profile yields its own tool names; no host → Claude Code, unchanged.
    fs.mkdirSync(path.join(tmp, '.specship'));
    expect(buildSteeringNudge(tmp, GEMINI_CLI_TRAITS, {}, tmp)).toContain(' specship_explore ');
    expect(buildSteeringNudge(tmp, GEMINI_CLI_TRAITS, {}, tmp)).not.toContain('mcp__specship__');
    expect(buildSteeringNudge(tmp, DEFAULT_HOST_TRAITS, {}, tmp)).toBe(STEERING_TEXT);
    expect(DEFAULT_HOST_TRAITS).toBe(CLAUDE_CODE_TRAITS);
    expect(hostTraitsFor('gemini')).toBe(GEMINI_CLI_TRAITS);
    expect(hostTraitsFor('unknown')).toBe(DEFAULT_HOST_TRAITS);
    // The installer and the hooks read one profile.
    expect(claudeTarget.traits).toBe(CLAUDE_CODE_TRAITS);
    expect(geminiTarget.traits).toBe(GEMINI_CLI_TRAITS);
    expect(ALL_HOST_TRAITS.map((t) => t.id)).toEqual(['claude', 'gemini']);
    // The intercept reads deny-eligible and shell tools from the profile.
    const deny = buildSearchIntercept({
      cwd: tmp, sessionId: 's', transcriptPath: null, traits: GEMINI_CLI_TRAITS, toolName: 'grep_search', strict: true, env: {},
    });
    expect(deny).toBeNull(); // strict without a transcript allows
    const shell = buildSearchIntercept({
      cwd: tmp, sessionId: 's2', transcriptPath: null, traits: GEMINI_CLI_TRAITS,
      toolName: 'run_shell_command', toolInput: { command: 'npm test' }, env: {},
    });
    expect(shell).toBeNull(); // a non-search shell command passes through
    const claudeStrict = buildSearchIntercept({
      cwd: tmp, sessionId: 's3', transcriptPath: null, traits: CLAUDE_CODE_TRAITS, toolName: 'Grep', strict: true, denyEligible: true, env: {},
    });
    expect(claudeStrict).toEqual({ additionalContext: expect.any(String) }); // Claude never denies
  }
});
