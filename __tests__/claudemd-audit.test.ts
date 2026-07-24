/**
 * CLAUDEMD-DOC — deterministic CLAUDE.md governance audit: detector
 * behavior (REQ-CLAUDEMD-002), the fingerprint guard + persistence
 * (REQ-CLAUDEMD-001), and the read-only contract (REQ-CLAUDEMD-004.A1).
 *
 * @verifies REQ-CLAUDEMD-001
 * @verifies REQ-CLAUDEMD-002
 * @verifies REQ-CLAUDEMD-004
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { auditClaudeMd, runClaudeMdAudit, readClaudeMdAudit } from '../src/claudemd/audit';

describe('claudemd audit', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmd-audit-'));
    fs.mkdirSync(path.join(dir, '.specship'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const write = (rel: string, body: string) => {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  };
  const kinds = (a: { findings: Array<{ kind: string }> }) => a.findings.map((f) => f.kind);

  // --- REQ-CLAUDEMD-002 detectors ---------------------------------------

  it('flags a missing root', () => {
    expect(kinds(auditClaudeMd(dir))).toContain('missing-root');
  });

  it('A1: flags a >200-line root, not a 150-line one', () => {
    write('CLAUDE.md', Array.from({ length: 250 }, (_, i) => `line ${i}`).join('\n'));
    expect(kinds(auditClaudeMd(dir))).toContain('root-too-long');
    write('CLAUDE.md', Array.from({ length: 150 }, (_, i) => `line ${i}`).join('\n'));
    expect(kinds(auditClaudeMd(dir))).not.toContain('root-too-long');
  });

  it('flags a >100-line nested file', () => {
    write('CLAUDE.md', '# root\n');
    write('src/mod/CLAUDE.md', Array.from({ length: 130 }, (_, i) => `n ${i}`).join('\n'));
    const a = auditClaudeMd(dir);
    expect(a.findings.some((f) => f.kind === 'nested-too-long' && f.file === 'src/mod/CLAUDE.md')).toBe(true);
  });

  it('A2: flags verbatim non-trivial duplication, ignores short/markup lines', () => {
    const rule = 'Never call npm publish directly from a working tree, use the workflow.';
    write('CLAUDE.md', `# root\n\n${rule}\n\n- ok\n`);
    write('src/mod/CLAUDE.md', `# mod\n\n${rule}\n\n- ok\n`);
    const a = auditClaudeMd(dir);
    const dups = a.findings.filter((f) => f.kind === 'duplication');
    expect(dups).toHaveLength(1);
    expect(dups[0]!.file).toBe('src/mod/CLAUDE.md');
  });

  it('A3: flags a stale path reference; existing paths pass', () => {
    write('src/real.ts', 'export const x = 1;\n');
    write('CLAUDE.md', '# root\n\nSee `src/real.ts` and `src/gone.ts` for details.\n');
    const a = auditClaudeMd(dir);
    const stale = a.findings.filter((f) => f.kind === 'stale-path');
    expect(stale).toHaveLength(1);
    expect(stale[0]!.detail).toContain('src/gone.ts');
  });

  it('does not flag URLs, scoped packages, or globs as stale paths', () => {
    write('CLAUDE.md', '# root\n\nUse `@specship/specship` from `https://npmjs.com/x` matching `src/**/*.ts`.\n');
    expect(kinds(auditClaudeMd(dir))).not.toContain('stale-path');
  });

  it('A4: flags a manifest-bearing subdir without CLAUDE.md; root manifest and covered dirs pass', () => {
    write('CLAUDE.md', '# root\n');
    write('package.json', '{}');
    write('server/package.json', '{}');
    write('ui/package.json', '{}');
    write('ui/CLAUDE.md', '# ui module\n');
    const a = auditClaudeMd(dir);
    const cands = a.findings.filter((f) => f.kind === 'module-candidate').map((f) => f.file);
    expect(cands).toContain('server');
    expect(cands).not.toContain('ui');
    expect(cands).not.toContain('.');
  });

  // --- REQ-CLAUDEMD-001 persistence + fingerprint guard -------------------

  it('A1/A2: persists the audit and no-ops when nothing changed', () => {
    write('CLAUDE.md', '# root\n\nSee `src/gone.ts`.\n');
    const first = runClaudeMdAudit(dir);
    expect(first).not.toBeNull();
    const auditFile = path.join(dir, '.specship', 'claudemd-audit.json');
    expect(fs.existsSync(auditFile)).toBe(true);
    const mtime1 = fs.statSync(auditFile).mtimeMs;

    const second = runClaudeMdAudit(dir);
    expect(second?.hash).toBe(first?.hash);
    expect(fs.statSync(auditFile).mtimeMs).toBe(mtime1); // not rewritten

    // A change re-runs and rewrites.
    write('src/gone.ts', 'export {};\n');
    write('CLAUDE.md', '# root\n\nSee `src/gone.ts`. Now it exists.\n');
    const third = runClaudeMdAudit(dir);
    expect(third?.hash).not.toBe(first?.hash);
    expect(third?.findings.filter((f) => f.kind === 'stale-path')).toHaveLength(0);
  });

  it('readClaudeMdAudit returns the stored audit and null when absent', () => {
    expect(readClaudeMdAudit(dir)).toBeNull();
    write('CLAUDE.md', '# root\n');
    runClaudeMdAudit(dir);
    expect(readClaudeMdAudit(dir)?.files).toContain('CLAUDE.md');
  });

  // --- REQ-CLAUDEMD-004.A1 read-only contract -----------------------------

  it('the audit module never writes to a CLAUDE.md (source scan)', () => {
    const src = fs.readFileSync(path.resolve('src/claudemd/audit.ts'), 'utf-8');
    // Only readFileSync/statSync/readdirSync touch the hierarchy; the sole
    // write is the audit JSON via writeJsonAtomic.
    expect(src).not.toMatch(/writeFileSync/);
    expect(src).not.toMatch(/appendFileSync/);
    const audit = auditClaudeMd(dir); // and running it leaves no CLAUDE.md behind
    expect(audit.findings.length).toBeGreaterThan(0); // missing-root
    expect(fs.existsSync(path.join(dir, 'CLAUDE.md'))).toBe(false);
  });

  it('skips node_modules and dot-dirs during discovery', () => {
    write('CLAUDE.md', '# root\n');
    write('node_modules/dep/CLAUDE.md', Array.from({ length: 300 }, () => 'x'.repeat(40)).join('\n'));
    write('.claude/worktrees/w1/CLAUDE.md', '# copy\n');
    const a = auditClaudeMd(dir);
    expect(a.files).toEqual(['CLAUDE.md']);
  });
});
