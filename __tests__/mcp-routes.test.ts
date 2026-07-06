import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import {
  addServer,
  configuredServers,
  deriveState,
  McpConfigError,
  probeServer,
  setServerEnabled,
  type McpConfigPaths,
} from '../server/src/routes/mcp';

/**
 * REQ-DESKTOP-026 — MCP route helpers. The inventory merges Claude Code's
 * three config surfaces (~/.claude.json global, projects[<root>] entry,
 * <root>/.mcp.json) with disabled detection; deriveState maps to the spec
 * vocabulary; enable/disable round-trips on the OWNING file atomically and
 * byte-preserves every unrelated key (these are the user's live Claude Code
 * configs); add-server rejects duplicates; the probe never throws and treats
 * a timeout as failed (A3, A4).
 */

let tmp: string;
let claudeJsonPath: string;
let projectRoot: string;
let paths: McpConfigPaths;

/** Canonical machine formatting — what Claude Code / the installer write. */
function writeJson(p: string, data: unknown): void {
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n');
}

const read = (p: string) => fs.readFileSync(p, 'utf8');
const mcpJsonPath = () => path.join(projectRoot, '.mcp.json');

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcproutes-'));
  claudeJsonPath = path.join(tmp, '.claude.json');
  projectRoot = path.join(tmp, 'dev', 'app');
  fs.mkdirSync(projectRoot, { recursive: true });
  paths = { claudeJsonPath, projectRoot };
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('configuredServers — three surfaces, merged', () => {
  it('merges user, project-local and .mcp.json entries with .mcp.json winning collisions', () => {
    writeJson(claudeJsonPath, {
      mcpServers: { alpha: { command: 'alpha-bin' }, shared: { command: 'from-user' } },
      projects: {
        [projectRoot]: {
          mcpServers: { beta: { command: 'beta-bin' } },
          mcpServersDisabled: { gamma: { command: 'gamma-bin' } },
        },
      },
    });
    writeJson(mcpJsonPath(), {
      mcpServers: { shared: { command: 'from-mcpjson' }, delta: { url: 'https://mcp.example/sse' } },
    });

    const servers = configuredServers(paths);
    expect(servers.get('alpha')).toMatchObject({ scope: 'user', configFile: claudeJsonPath, disabled: false, container: 'user' });
    expect(servers.get('beta')).toMatchObject({ scope: 'project', configFile: claudeJsonPath, disabled: false, container: 'project-local' });
    expect(servers.get('gamma')).toMatchObject({ scope: 'project', disabled: true, container: 'project-local' });
    // Collision: the .mcp.json entry is what Claude Code actually loads.
    expect(servers.get('shared')).toMatchObject({
      scope: 'project', configFile: mcpJsonPath(), container: 'mcpjson',
      entry: { command: 'from-mcpjson' },
    });
    expect(servers.get('delta')).toMatchObject({ configFile: mcpJsonPath(), disabled: false });
  });

  it('marks .mcp.json entries listed in disabledMcpjsonServers as disabled', () => {
    writeJson(claudeJsonPath, { projects: { [projectRoot]: { disabledMcpjsonServers: ['delta'] } } });
    writeJson(mcpJsonPath(), { mcpServers: { delta: { command: 'delta-bin' } } });

    expect(configuredServers(paths).get('delta')).toMatchObject({ disabled: true, configFile: mcpJsonPath() });
  });

  it('marks ~/.claude.json entries parked in mcpServersDisabled as disabled', () => {
    writeJson(claudeJsonPath, { mcpServersDisabled: { alpha: { command: 'alpha-bin' } } });
    expect(configuredServers(paths).get('alpha')).toMatchObject({ scope: 'user', disabled: true });
  });

  it('reads only the user surface when no project is open', () => {
    writeJson(claudeJsonPath, {
      mcpServers: { alpha: { command: 'a' } },
      projects: { [projectRoot]: { mcpServers: { beta: { command: 'b' } } } },
    });
    writeJson(mcpJsonPath(), { mcpServers: { delta: { command: 'd' } } });

    const servers = configuredServers({ claudeJsonPath, projectRoot: null });
    expect([...servers.keys()]).toEqual(['alpha']);
  });

  it('returns an empty map for missing or unparseable files', () => {
    expect(configuredServers(paths).size).toBe(0);
    fs.writeFileSync(claudeJsonPath, '{ not json');
    expect(configuredServers(paths).size).toBe(0);
  });
});

describe('deriveState — spec vocabulary and precedence', () => {
  const now = 1_750_000_000_000;
  const recent = { lastMs: now - 3600_000 };
  const stale = { lastMs: now - 48 * 3600_000 };

  it('disabled beats everything', () => {
    expect(deriveState({ disabled: true }, recent, 'ok', now)).toBe('disabled');
  });
  it('a refused probe beats recent usage', () => {
    expect(deriveState({ disabled: false }, recent, 'failed', now)).toBe('failed');
  });
  it('calls in the last 24h → active', () => {
    expect(deriveState({ disabled: false }, recent, null, now)).toBe('active');
    expect(deriveState({ disabled: false }, recent, 'ok', now)).toBe('active');
  });
  it('probe answered without recent usage → connected', () => {
    expect(deriveState({ disabled: false }, stale, 'ok', now)).toBe('connected');
    expect(deriveState({ disabled: false }, null, 'ok', now)).toBe('connected');
  });
  it('otherwise idle (configured-but-quiet, usage-only, stale usage)', () => {
    expect(deriveState({ disabled: false }, null, null, now)).toBe('idle');
    expect(deriveState(null, stale, null, now)).toBe('idle');
  });
});

describe('setServerEnabled — round-trips on the owning file', () => {
  it('.mcp.json-owned: toggles disabledMcpjsonServers in ~/.claude.json, never touches .mcp.json', () => {
    writeJson(claudeJsonPath, {
      numStartups: 12,
      oauthAccount: { emailAddress: 'user@example.com' },
      projects: { [projectRoot]: { allowedTools: ['Bash'], history: [{ display: 'hi' }] } },
    });
    writeJson(mcpJsonPath(), { mcpServers: { specship: { command: 'specship', args: ['serve', '--mcp'] }, playwright: { command: 'npx', args: ['-y', '@playwright/mcp'] } } });
    const originalClaude = read(claudeJsonPath);
    const originalMcp = read(mcpJsonPath());

    setServerEnabled(paths, 'playwright', false);
    // The team-shared .mcp.json is byte-untouched; the flag is Claude Code's own.
    expect(read(mcpJsonPath())).toBe(originalMcp);
    const cj = JSON.parse(read(claudeJsonPath));
    expect(cj.projects[projectRoot].disabledMcpjsonServers).toEqual(['playwright']);
    expect(cj.numStartups).toBe(12);
    expect(configuredServers(paths).get('playwright')!.disabled).toBe(true);

    setServerEnabled(paths, 'playwright', true);
    // Strict bar: the round-trip restores ~/.claude.json byte-for-byte (the
    // emptied disabledMcpjsonServers key is removed, not left behind).
    expect(read(claudeJsonPath)).toBe(originalClaude);
    expect(read(mcpJsonPath())).toBe(originalMcp);
    expect(configuredServers(paths).get('playwright')!.disabled).toBe(false);
  });

  it('~/.claude.json user-owned: parks in mcpServersDisabled and restores byte-for-byte', () => {
    writeJson(claudeJsonPath, {
      numStartups: 3,
      mcpServers: { alpha: { command: 'alpha-bin', env: { KEY: 'v' } }, target: { command: 'target-bin' } },
      oauthAccount: { emailAddress: 'user@example.com' },
    });
    const original = read(claudeJsonPath);
    // The sibling entry's exact serialized block, captured from the original
    // (up to the `,` that separates it from the removed entry).
    const alphaLines = original.slice(original.indexOf('"alpha"'), original.indexOf(',\n    "target"'));

    setServerEnabled(paths, 'target', false);
    const disabledText = read(claudeJsonPath);
    const cj = JSON.parse(disabledText);
    expect(cj.mcpServers).toEqual({ alpha: { command: 'alpha-bin', env: { KEY: 'v' } } });
    expect(cj.mcpServersDisabled).toEqual({ target: { command: 'target-bin' } });
    expect(cj.numStartups).toBe(3);
    expect(cj.oauthAccount).toEqual({ emailAddress: 'user@example.com' });
    // Unrelated sibling entry survives byte-for-byte.
    expect(disabledText).toContain(alphaLines);

    setServerEnabled(paths, 'target', true);
    expect(read(claudeJsonPath)).toBe(original);
  });

  it('~/.claude.json project-local: moves within the projects[<root>] entry and restores byte-for-byte', () => {
    writeJson(claudeJsonPath, {
      projects: {
        [projectRoot]: {
          allowedTools: [],
          mcpServers: { beta: { command: 'beta-bin' } },
        },
        '/some/other/project': { mcpServers: { other: { command: 'other-bin' } } },
      },
    });
    const original = read(claudeJsonPath);

    setServerEnabled(paths, 'beta', false);
    const cj = JSON.parse(read(claudeJsonPath));
    // The emptied mcpServers map stays in place — that's what lets re-enable
    // restore the file byte-for-byte instead of appending the key at the end.
    expect(cj.projects[projectRoot].mcpServers).toEqual({});
    expect(cj.projects[projectRoot].mcpServersDisabled).toEqual({ beta: { command: 'beta-bin' } });
    // The neighbour project's entry is untouched.
    expect(cj.projects['/some/other/project']).toEqual({ mcpServers: { other: { command: 'other-bin' } } });

    setServerEnabled(paths, 'beta', true);
    expect(read(claudeJsonPath)).toBe(original);
  });

  it('re-enabling a mid-map entry restores it semantically (appended last), siblings byte-preserved', () => {
    // Position metadata isn't stored in the user's config, so an entry that
    // wasn't last comes back at the END of mcpServers — same values, every
    // sibling key byte-identical, only the map's entry order differs.
    writeJson(claudeJsonPath, {
      mcpServers: { target: { command: 'target-bin' }, alpha: { command: 'alpha-bin' } },
      numStartups: 9,
    });
    const before = JSON.parse(read(claudeJsonPath));

    setServerEnabled(paths, 'target', false);
    setServerEnabled(paths, 'target', true);

    const after = read(claudeJsonPath);
    expect(JSON.parse(after)).toEqual(before);
    expect(Object.keys(JSON.parse(after).mcpServers)).toEqual(['alpha', 'target']);
    expect(after).toContain('"alpha": {\n      "command": "alpha-bin"\n    }');
    expect(after).toContain('"numStartups": 9');
  });

  it('preserves the file\'s indentation unit and missing trailing newline', () => {
    fs.writeFileSync(
      claudeJsonPath,
      JSON.stringify({ mcpServers: { target: { command: 'target-bin' } }, keep: true }, null, '\t'),
    ); // tab-indented, NO trailing newline
    const original = read(claudeJsonPath);

    setServerEnabled(paths, 'target', false);
    const disabledText = read(claudeJsonPath);
    expect(disabledText).toContain('\n\t"keep": true');
    expect(disabledText.endsWith('\n')).toBe(false);

    setServerEnabled(paths, 'target', true);
    expect(read(claudeJsonPath)).toBe(original);
  });

  it('is idempotent: a no-op toggle does not rewrite the file', () => {
    writeJson(claudeJsonPath, { mcpServers: { alpha: { command: 'a' } } });
    const before = fs.statSync(claudeJsonPath).mtimeMs;
    const result = setServerEnabled(paths, 'alpha', true); // already enabled
    expect(result.disabled).toBe(false);
    expect(fs.statSync(claudeJsonPath).mtimeMs).toBe(before);
  });

  it('throws 404 for a name not configured anywhere', () => {
    writeJson(claudeJsonPath, { mcpServers: {} });
    let err: unknown;
    try { setServerEnabled(paths, 'ghost', false); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(McpConfigError);
    expect((err as McpConfigError).statusCode).toBe(404);
  });

  it('refuses to clobber an unparseable config file', () => {
    writeJson(claudeJsonPath, { mcpServers: { alpha: { command: 'a' } } });
    writeJson(mcpJsonPath(), { mcpServers: { delta: { command: 'd' } } });
    fs.writeFileSync(claudeJsonPath, '{ "mcpServers": { broken');
    const brokenBytes = read(claudeJsonPath);

    let err: unknown;
    try { setServerEnabled(paths, 'delta', false); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(McpConfigError);
    expect((err as McpConfigError).statusCode).toBe(500);
    expect(read(claudeJsonPath)).toBe(brokenBytes);
  });
});

describe('addServer — guided add with duplicate rejection', () => {
  it('rejects a duplicate name on any surface with 409', () => {
    writeJson(mcpJsonPath(), { mcpServers: { specship: { command: 'specship' } } });
    let err: unknown;
    try { addServer(paths, { name: 'specship', scope: 'user', command: 'other' }); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(McpConfigError);
    expect((err as McpConfigError).statusCode).toBe(409);
  });

  it('user scope writes ~/.claude.json mcpServers, preserving unrelated keys', () => {
    writeJson(claudeJsonPath, { numStartups: 5 });
    const added = addServer(paths, { name: 'github', scope: 'user', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] });
    expect(added).toMatchObject({ configFile: claudeJsonPath, disabled: false });

    const cj = JSON.parse(read(claudeJsonPath));
    expect(cj.numStartups).toBe(5);
    expect(cj.mcpServers.github).toEqual({ type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] });
  });

  it('project scope writes <root>/.mcp.json and leaves ~/.claude.json alone', () => {
    writeJson(claudeJsonPath, { numStartups: 5 });
    const originalClaude = read(claudeJsonPath);
    const added = addServer(paths, { name: 'sentry', scope: 'project', url: 'https://mcp.sentry.dev/sse' });
    expect(added.configFile).toBe(mcpJsonPath());

    expect(JSON.parse(read(mcpJsonPath())).mcpServers.sentry).toEqual({ type: 'http', url: 'https://mcp.sentry.dev/sse' });
    expect(read(claudeJsonPath)).toBe(originalClaude);
  });

  it('validates input: empty name, whitespace name, missing command/url, projectless project scope', () => {
    const bad = (input: Parameters<typeof addServer>[1], p: McpConfigPaths = paths) => {
      try { addServer(p, input); } catch (e) { return (e as McpConfigError).statusCode; }
      return null;
    };
    expect(bad({ name: '', scope: 'user', command: 'x' })).toBe(400);
    expect(bad({ name: 'two words', scope: 'user', command: 'x' })).toBe(400);
    expect(bad({ name: 'ok', scope: 'user' })).toBe(400);
    expect(bad({ name: 'ok', scope: 'project', command: 'x' }, { claudeJsonPath, projectRoot: null })).toBe(400);
  });
});

describe('probeServer — never throws, timeout = failed (A3, A4)', () => {
  it('a nonexistent command resolves failed', async () => {
    const result = await probeServer({ command: path.join(tmp, 'no-such-binary') }, 1500);
    expect(result).toBe('failed');
  });

  it('a hung process times out to failed', async () => {
    const result = await probeServer(
      { command: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'] },
      600,
    );
    expect(result).toBe('failed');
  });

  it('a stdio server answering MCP initialize resolves ok', async () => {
    const script = `
      let buf = '';
      process.stdin.on('data', (d) => {
        buf += d.toString();
        const nl = buf.indexOf('\\n');
        if (nl === -1) return;
        const msg = JSON.parse(buf.slice(0, nl));
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2025-06-18' } }) + '\\n');
      });
      setInterval(() => {}, 1000);
    `;
    const result = await probeServer({ command: process.execPath, args: ['-e', script] }, 8000);
    expect(result).toBe('ok');
  });

  it('a url entry: 2xx is ok, an unreachable port is failed', async () => {
    const server = http.createServer((_req, res) => { res.writeHead(200); res.end('{}'); });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address() as { port: number };
    try {
      expect(await probeServer({ url: `http://127.0.0.1:${port}/mcp` }, 1500)).toBe('ok');
    } finally {
      server.close();
    }
    // The listener is closed now — same host, fresh path to dodge the cache.
    expect(await probeServer({ url: `http://127.0.0.1:${port}/gone` }, 1500)).toBe('failed');
  });
});
