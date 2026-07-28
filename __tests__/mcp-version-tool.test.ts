/**
 * REQ-MCPVER-001 — `specship_version` MCP tool.
 *
 * Zero-arg identity probe: returns package version, install method,
 * install dir, node version, and (if a project is bound) project root.
 * Must work with NO project open and NEVER touch the DB.
 */
import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { ToolHandler } from '../src/mcp/tools';
import { SpecShipPackageVersion } from '../src/mcp/version';
import { detectInstallMethod, resolveInstallDir } from '../src/update/updater';

const text = (r: { content?: Array<{ text?: string }> }) => r.content?.[0]?.text ?? '';

/** @verifies REQ-MCPVER-001 */
describe('REQ-MCPVER-001 — specship_version', () => {
  it('A1: response contains the resolved package version verbatim', async () => {
    const handler = new ToolHandler(null);
    const out = text(await handler.execute('specship_version', {}));
    expect(out).toContain(SpecShipPackageVersion);
    expect(out).toContain('**version:**');
  });

  it('A2: install-method classifier — bundle / npm / unknown', () => {
    const installDir = '/opt/specship-install';
    expect(detectInstallMethod(installDir, installDir)).toBe('bundle');
    expect(detectInstallMethod(path.join(installDir, 'bin'), installDir)).toBe('bundle');
    expect(detectInstallMethod('/usr/local/lib/node_modules/@specship/specship/dist/bin', installDir)).toBe('npm');
    expect(detectInstallMethod('/some/random/place', installDir)).toBe('unknown');
  });

  it('A2: response reports installMethod + installDir', async () => {
    const handler = new ToolHandler(null);
    const out = text(await handler.execute('specship_version', {}));
    expect(out).toMatch(/\*\*installMethod:\*\* (bundle|npm|unknown)/);
    expect(out).toContain('**installDir:**');
    expect(out).toContain(resolveInstallDir());
  });

  it('A2: response names the install the running server was loaded from', async () => {
    const handler = new ToolHandler(null);
    const out = text(await handler.execute('specship_version', {}));
    // Two levels up from src/mcp/tools.ts — the package root serving this call,
    // which is what distinguishes a stale install from the `specship` on PATH.
    const loadedFrom = path.resolve(__dirname, '..', 'src', '..');
    expect(out).toContain('**loadedFrom:**');
    expect(out).toContain(loadedFrom);
  });

  it('A3: response reports node version and projectRoot=null when no project', async () => {
    const handler = new ToolHandler(null);
    const out = text(await handler.execute('specship_version', {}));
    expect(out).toContain(`**node:** ${process.version}`);
    expect(out).toContain('**projectRoot:** null');
  });

  it('A5: executes without touching the DB (null cg → no throw)', async () => {
    const handler = new ToolHandler(null);
    const r = await handler.execute('specship_version', {});
    expect(r.isError).toBeFalsy();
    expect(text(r)).toContain('SpecShip Version');
  });

  it('SPECSHIP_INSTALL_DIR env overrides the default install dir', () => {
    const saved = process.env.SPECSHIP_INSTALL_DIR;
    process.env.SPECSHIP_INSTALL_DIR = '/tmp/override-install';
    try {
      expect(resolveInstallDir()).toBe('/tmp/override-install');
    } finally {
      if (saved === undefined) delete process.env.SPECSHIP_INSTALL_DIR;
      else process.env.SPECSHIP_INSTALL_DIR = saved;
    }
  });
});
