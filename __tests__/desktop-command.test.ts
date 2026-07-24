/**
 * DESKTOP-CMD-DOC — `specship desktop` is the dashboard's own command and
 * `serve --ui` is retired with a pointer.
 *
 * Drives the built binary so the command surface (help text, option parsing,
 * exit codes) is exercised end-to-end. The `desktop` command's actual server
 * boot is covered by ui-serve-smoke.test.ts / desktop-server-layout.test.ts;
 * here we assert the CLI wiring only, without starting a long-lived server.
 *
 * @verifies REQ-DESKTOP-CMD-001
 * @verifies REQ-DESKTOP-CMD-002
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import * as path from 'path';

const BIN = path.resolve(__dirname, '../dist/bin/specship.js');

/**
 * Run the binary, capturing BOTH stdout and stderr plus the exit code. The
 * info/help/error text under test is written to stderr (stdout stays clean
 * for stdio consumers), so merge both streams.
 */
function run(args: string[]): { code: number; out: string } {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf-8',
    env: { ...process.env, SPECSHIP_NO_DAEMON: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

describe('specship desktop command (REQ-DESKTOP-CMD-001)', () => {
  it('A4: is a registered top-level command named for the desktop dashboard', () => {
    const { code, out } = run(['desktop', '--help']);
    expect(code).toBe(0);
    expect(out).toMatch(/SpecShip Desktop dashboard/i);
    expect(out).toContain('Usage: specship desktop');
  });

  it('A2/A3: exposes the dashboard options plus --mcp', () => {
    const { out } = run(['desktop', '--help']);
    for (const opt of ['--port', '--host', '--ingest', '--no-ingest', '--web-dir', '--no-web', '--no-watch', '--mcp']) {
      expect(out, opt).toContain(opt);
    }
  });

  it('appears in the top-level command list', () => {
    const { out } = run(['--help']);
    expect(out).toMatch(/^\s*desktop\b/m);
  });
});

describe('serve --ui retirement (REQ-DESKTOP-CMD-002)', () => {
  it('A1: `serve --ui` exits non-zero pointing at `specship desktop`', () => {
    const { code, out } = run(['serve', '--ui']);
    expect(code).not.toBe(0);
    expect(out).toContain('specship desktop');
    expect(out).not.toMatch(/unknown option/i);
  });

  it('A1: the UI-only companion flags also route to the pointer', () => {
    for (const flag of [['--port', '5000'], ['--host', '0.0.0.0'], ['--web-dir', '/tmp/x'], ['--ingest']]) {
      const { code, out } = run(['serve', ...flag]);
      expect(code, flag.join(' ')).not.toBe(0);
      expect(out, flag.join(' ')).toContain('specship desktop');
    }
  });

  it('A2: `serve` with no flags still prints the MCP info screen (exit 0)', () => {
    const { code, out } = run(['serve']);
    expect(code).toBe(0);
    expect(out).toContain('SpecShip MCP Server');
    expect(out).toContain('"--mcp"'); // the config snippet still shows serve --mcp
  });

  it('serve --help no longer advertises --ui', () => {
    const { out } = run(['serve', '--help']);
    expect(out).not.toContain('--ui');
    expect(out).toContain('--mcp');
    expect(out).toContain('--no-watch');
  });
});
