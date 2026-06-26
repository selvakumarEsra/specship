/**
 * Tests for the `specship domain-gaps` CLI subcommand — the thin surface over
 * SpecShip.getDomainGapSeed (REQ-DOMAIN-003) that lets the `/ss-domain` capture
 * command (REQ-DOMAIN-004) cite the SAME real undocumented entities the library
 * computes (REQ-DOMAIN-004.A4) without a new MCP tool (REQ-DOMAIN-005).
 *
 * Exercised end-to-end against the built binary so the `--json` field names
 * (`entities`, `specs`, `coverage`) survive future plumbing refactors.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SpecShip } from '../src';

const BIN = path.resolve(__dirname, '../dist/bin/specship.js');

function runDomainGaps(cwd: string, args: string[] = []): string {
  return execFileSync(process.execPath, [BIN, 'domain-gaps', ...args], {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, SPECSHIP_NO_DAEMON: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function runDomainGapsJson(cwd: string): {
  entities: Array<{ name: string; kind: string; qualifiedName: string; filePath: string }>;
  specs: Array<{ id: string; title: string; kind: string }>;
  coverage: { documented: number; gaps: number };
} {
  const stdout = runDomainGaps(cwd, ['--json']);
  const line = stdout.trim().split('\n').filter(Boolean).join('\n');
  return JSON.parse(line);
}

describe('specship domain-gaps — gap-seed CLI surface (REQ-DOMAIN-003/004)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'specship-domain-gaps-'));
  });
  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('--json lists an undocumented class entity with the real gap-seed shape (A1)', async () => {
    fs.writeFileSync(
      path.join(tempDir, 'payment.ts'),
      'export class Payment {\n  settle() {}\n}\n',
    );
    const cg = SpecShip.initSync(tempDir);
    await cg.indexAll();
    cg.close();

    const out = runDomainGapsJson(tempDir);
    expect(Array.isArray(out.entities)).toBe(true);
    expect(Array.isArray(out.specs)).toBe(true);
    expect(typeof out.coverage.documented).toBe('number');
    expect(typeof out.coverage.gaps).toBe('number');

    // The undocumented `Payment` class is surfaced as a gap entity.
    expect(out.entities.some((e) => e.name === 'Payment' && e.kind === 'class')).toBe(true);
    // documented + gaps reconstitutes the universe (A3); with no domain facts,
    // documented is 0 and the class shows up in the gap count.
    expect(out.coverage.gaps).toBeGreaterThanOrEqual(1);
    expect(out.coverage.documented).toBe(0);
  });

  it('text mode prints a coverage line and the undocumented entity', async () => {
    fs.writeFileSync(
      path.join(tempDir, 'payment.ts'),
      'export class Payment {}\n',
    );
    const cg = SpecShip.initSync(tempDir);
    await cg.indexAll();
    cg.close();

    const out = runDomainGaps(tempDir);
    expect(out).toMatch(/Domain coverage:/);
    expect(out).toContain('Payment');
  });

  it('writes nothing — the pass is read-only', async () => {
    fs.writeFileSync(path.join(tempDir, 'payment.ts'), 'export class Payment {}\n');
    const cg = SpecShip.initSync(tempDir);
    await cg.indexAll();
    cg.close();

    // No specs/domain/ dir should be created by querying gaps.
    runDomainGapsJson(tempDir);
    expect(fs.existsSync(path.join(tempDir, 'specs', 'domain'))).toBe(false);
  });

  it('exits non-zero on an uninitialized project', () => {
    expect(() => runDomainGaps(tempDir, ['--json'])).toThrow();
  });
});
