/**
 * UNINSTALL-PURGE-DOC — the complete-uninstall (purge) planner + executor.
 *   REQ-UNINSTALL-001/002: the exact delete set per install method, executed
 *   best-effort with self-affecting removals last.
 * The planner is pure (no fs); the executor is exercised with mock deps and,
 * once, against a real temp filesystem. No test ever touches the real
 * ~/.specship — every path is synthetic or under os.tmpdir().
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  planPurge,
  executePurge,
  assertSafeToRemove,
  type PurgeEnv,
  type PurgeExecDeps,
} from '../src/installer/purge';

const HOME = path.join(path.sep, 'home', 'u');

function env(over: Partial<PurgeEnv> = {}): PurgeEnv {
  return {
    cwd: path.join(path.sep, 'proj'),
    homedir: HOME,
    installDir: path.join(HOME, '.specship'),
    binDir: path.join(HOME, '.local', 'bin'),
    method: 'bundle',
    ...over,
  };
}

describe('planPurge (REQ-UNINSTALL-001/002)', () => {
  it('bundle with default dirs: ~/.specship + PATH symlink, no npm', () => {
    const p = planPurge(env({ method: 'bundle' }));
    expect(p.projectIndex).toBe(path.join(path.sep, 'proj', '.specship'));
    expect(p.dataDirs).toEqual([path.join(HOME, '.specship')]); // install dir == data dir → deduped
    expect(p.symlink).toBe(path.join(HOME, '.local', 'bin', 'specship'));
    expect(p.npmRemove).toBe(false);
    expect(p.manualBinaryHint).toBeNull();
  });

  it('bundle with a custom install dir: removes both the data dir and the install dir', () => {
    const inst = path.join(path.sep, 'opt', 'ss');
    const p = planPurge(env({ method: 'bundle', installDir: inst }));
    expect(p.dataDirs).toEqual([path.join(HOME, '.specship'), inst]);
    expect(p.symlink).toBe(path.join(HOME, '.local', 'bin', 'specship'));
  });

  it('npm: ~/.specship removed, no symlink, npm removal flagged', () => {
    const p = planPurge(env({ method: 'npm' }));
    expect(p.dataDirs).toEqual([path.join(HOME, '.specship')]);
    expect(p.symlink).toBeNull();
    expect(p.npmRemove).toBe(true);
    expect(p.manualBinaryHint).toBeNull();
  });

  it('unknown: no auto binary removal, prints a manual hint', () => {
    const p = planPurge(env({ method: 'unknown' }));
    expect(p.symlink).toBeNull();
    expect(p.npmRemove).toBe(false);
    expect(p.manualBinaryHint).toMatch(/npm rm -g @specship\/specship/);
  });
});

describe('assertSafeToRemove', () => {
  it('throws on a filesystem root, the home dir, and top-level dirs', () => {
    expect(() => assertSafeToRemove(path.sep, HOME)).toThrow(/unsafe/);
    expect(() => assertSafeToRemove(HOME, HOME)).toThrow(/unsafe/);
    expect(() => assertSafeToRemove(path.join(path.sep, 'usr'), HOME)).toThrow(/unsafe/);
  });
  it('allows the real purge targets', () => {
    expect(() => assertSafeToRemove(path.join(HOME, '.specship'), HOME)).not.toThrow();
    expect(() => assertSafeToRemove(path.join(path.sep, 'proj', '.specship'), HOME)).not.toThrow();
  });
});

function mockDeps(over: Partial<PurgeExecDeps> = {}) {
  const removed: string[] = [];
  let npm = 0;
  const deps: PurgeExecDeps = {
    rmDir: (p) => { removed.push(p); return true; },
    rmFile: (p) => { removed.push(p); return true; },
    runNpmRemove: () => { npm++; return { ok: true, detail: 'npm ok' }; },
    log: () => {},
    ...over,
  };
  return { deps, removed, npmCalls: () => npm };
}

describe('executePurge (REQ-UNINSTALL-001/002)', () => {
  it('bundle: removes index, symlink, and data dir; never calls npm', () => {
    const { deps, removed, npmCalls } = mockDeps();
    const res = executePurge(planPurge(env({ method: 'bundle' })), deps);
    expect(removed).toContain(path.join(path.sep, 'proj', '.specship'));
    expect(removed).toContain(path.join(HOME, '.local', 'bin', 'specship'));
    expect(removed).toContain(path.join(HOME, '.specship'));
    expect(npmCalls()).toBe(0);
    expect(res.notes).toEqual([]);
  });

  it('npm: runs npm rm -g AND still removes the data dir (A2)', () => {
    const { deps, removed, npmCalls } = mockDeps();
    const res = executePurge(planPurge(env({ method: 'npm' })), deps);
    expect(npmCalls()).toBe(1);
    expect(removed).toContain(path.join(HOME, '.specship'));
    expect(res.removed).toContain('@specship/specship (npm global)');
  });

  it('the data dir is removed AFTER the index (self-affecting removal is last)', () => {
    const { deps, removed } = mockDeps();
    executePurge(planPurge(env({ method: 'bundle' })), deps);
    expect(removed.indexOf(path.join(path.sep, 'proj', '.specship')))
      .toBeLessThan(removed.indexOf(path.join(HOME, '.specship')));
  });

  it('best-effort: an OS refusal on one path becomes a note, not a throw (A4)', () => {
    const { deps } = mockDeps({
      rmDir: (p) => { if (p === path.join(HOME, '.specship')) throw new Error('EBUSY'); return true; },
    });
    const res = executePurge(planPurge(env({ method: 'bundle' })), deps);
    expect(res.notes.some((n) => /could not remove.*EBUSY/.test(n))).toBe(true);
  });

  it('unknown: appends the manual binary hint to notes (A3)', () => {
    const res = executePurge(planPurge(env({ method: 'unknown' })), mockDeps().deps);
    expect(res.notes.some((n) => /npm rm -g @specship\/specship/.test(n))).toBe(true);
  });

  it('a failed npm removal is reported as a note, not thrown', () => {
    const { deps } = mockDeps({ runNpmRemove: () => ({ ok: false, detail: 'npm failed' }) });
    const res = executePurge(planPurge(env({ method: 'npm' })), deps);
    expect(res.notes).toContain('npm failed');
  });
});

describe('executePurge against a real temp filesystem', () => {
  it('actually deletes the index, data dir, and PATH symlink on disk', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-purge-'));
    try {
      const home = path.join(tmp, 'home');
      const proj = path.join(tmp, 'proj');
      const data = path.join(home, '.specship');
      const idx = path.join(proj, '.specship');
      const bin = path.join(home, '.local', 'bin');
      const link = path.join(bin, 'specship');
      fs.mkdirSync(path.join(data, 'sub'), { recursive: true });
      fs.writeFileSync(path.join(data, 'jira.json'), '{}');
      fs.mkdirSync(idx, { recursive: true });
      fs.mkdirSync(bin, { recursive: true });
      fs.writeFileSync(link, 'launcher'); // stand-in for the symlink

      const plan = planPurge({ cwd: proj, homedir: home, installDir: data, binDir: bin, method: 'bundle' });
      const deps: PurgeExecDeps = {
        rmDir: (p) => { assertSafeToRemove(p, home); if (!fs.existsSync(p)) return false; fs.rmSync(p, { recursive: true, force: true }); return true; },
        rmFile: (p) => { try { fs.lstatSync(p); } catch { return false; } fs.rmSync(p, { force: true }); return true; },
        runNpmRemove: () => ({ ok: true, detail: 'ok' }),
        log: () => {},
      };
      executePurge(plan, deps);

      expect(fs.existsSync(idx)).toBe(false);
      expect(fs.existsSync(data)).toBe(false);
      expect(fs.existsSync(link)).toBe(false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
