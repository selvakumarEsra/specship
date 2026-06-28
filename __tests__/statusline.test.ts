/**
 * SHIP-STATUSLINE-DOC — the `specship statusline` segment.
 *
 * Covers the render contract (REQ-STATUSLINE-001/005), the cache-only read
 * path (002), the Tier-A cache round-trip (003), and the per-session marker
 * (004). No database is touched anywhere in here — that is the whole point.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { renderSegment } from '../src/statusline/render';
import { writeStatuslineCache, readStatuslineCache } from '../src/statusline/cache';
import {
  initSession,
  recordCall,
  readSessionMarker,
  __resetSessionGuardForTests,
} from '../src/statusline/session-marker';
import { writeActiveRun, readActiveRun, clearActiveRun } from '../src/statusline/active-run';
import { buildSegment } from '../src/statusline/index';
import { StatuslineCache, SessionMarker } from '../src/statusline/types';

const ANSI = /\[[0-9;]*m/;

function fullCache(over: Partial<StatuslineCache> = {}): StatuslineCache {
  return {
    v: 1,
    initialized: true,
    updatedAt: 1,
    pending: { added: 0, modified: 0, removed: 0 },
    drift: 0,
    backend: 'better-sqlite3',
    degraded: false,
    fileCount: 100,
    nodeCount: 2000,
    lastIndexed: 1,
    ...over,
  };
}

const noMarker: SessionMarker | null = null;

describe('renderSegment (REQ-STATUSLINE-001/005)', () => {
  it('shows a synced indicator when there are no pending changes', () => {
    const out = renderSegment({ cache: fullCache(), marker: null, run: null, noColor: true });
    expect(out).toContain('synced');
    expect(out).not.toContain('pending');
  });

  it('shows the pending count when changes await sync (A1)', () => {
    const out = renderSegment({
      cache: fullCache({ pending: { added: 1, modified: 2, removed: 0 } }),
      marker: null, run: null, noColor: true,
    });
    expect(out).toContain('3 pending');
    expect(out).not.toContain('synced');
  });

  it('flags the drift queue only when non-zero', () => {
    expect(renderSegment({ cache: fullCache({ drift: 2 }), marker: null, run: null, noColor: true }))
      .toContain('2 drift');
    expect(renderSegment({ cache: fullCache({ drift: 0 }), marker: null, run: null, noColor: true }))
      .not.toContain('drift');
  });

  it('flags a degraded (non-WAL) backend, naming it (A2)', () => {
    const out = renderSegment({
      cache: fullCache({ degraded: true, backend: 'node-sqlite' }),
      marker: null, run: null, noColor: true,
    });
    expect(out).toContain('node-sqlite');
    const healthy = renderSegment({ cache: fullCache({ degraded: false }), marker: null, run: null, noColor: true });
    expect(healthy).not.toContain('⚠');
  });

  it('shows the session call count with singular/plural and a zero placeholder (A3)', () => {
    const zero = renderSegment({ cache: fullCache(), marker: null, run: null, noColor: true });
    expect(zero).toContain('0 calls');
    const one = renderSegment({ cache: fullCache(), marker: { v: 1, startedAt: 1, calls: 1, lastTool: 'specship_explore', lastAt: 1 }, run: null, noColor: true });
    expect(one).toContain('1 call');
    expect(one).not.toContain('1 calls');
  });

  it('shows the active run when present and omits it otherwise (A4)', () => {
    const withRun = renderSegment({
      cache: fullCache(), marker: null,
      run: { v: 1, specId: 'REQ-STATUSLINE-001', status: 'running', updatedAt: 1 },
      noColor: true,
    });
    expect(withRun).toContain('REQ-STATUSLINE-001');
    expect(withRun).toContain('running');
    const noRun = renderSegment({ cache: fullCache(), marker: null, run: null, noColor: true });
    expect(noRun).not.toContain('REQ-');
  });

  it('emits no ANSI when noColor is set (001.A4)', () => {
    const plain = renderSegment({ cache: fullCache({ drift: 3, degraded: true }), marker: null, run: null, noColor: true });
    expect(ANSI.test(plain)).toBe(false);
    const colored = renderSegment({ cache: fullCache(), marker: null, run: null, noColor: false });
    expect(ANSI.test(colored)).toBe(true);
  });

  it('NEVER emits a tokens-saved figure (005.A5 — the honesty rule)', () => {
    const out = renderSegment({
      cache: fullCache({ drift: 5, degraded: true, pending: { added: 4, modified: 0, removed: 0 } }),
      marker: { v: 1, startedAt: 1, calls: 99, lastTool: 'specship_node', lastAt: 1 },
      run: { v: 1, specId: 'REQ-X', status: 'running', updatedAt: 1 },
      noColor: true,
    });
    expect(out.toLowerCase()).not.toContain('saved');
    expect(out).not.toMatch(/saved|tokens?\s*saved/i);
  });

  it('degrades to an idle line when there is no cache, still naming specship', () => {
    const out = renderSegment({ cache: null, marker: null, run: null, noColor: true });
    expect(out).toContain('specship');
    expect(out).toContain('idle');
    // never throws, always a single line
    expect(out.split('\n')).toHaveLength(1);
  });
});

describe('statusline cache round-trip (REQ-STATUSLINE-003)', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-cache-')); fs.mkdirSync(path.join(dir, '.specship')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('writes then reads back the same Tier-A fields', () => {
    writeStatuslineCache(dir, {
      initialized: true,
      pending: { added: 2, modified: 1, removed: 0 },
      drift: 3,
      backend: 'better-sqlite3',
      degraded: false,
      fileCount: 42,
      nodeCount: 900,
      lastIndexed: 123,
    });
    const c = readStatuslineCache(dir)!;
    expect(c).not.toBeNull();
    expect(c.pending).toEqual({ added: 2, modified: 1, removed: 0 });
    expect(c.drift).toBe(3);
    expect(c.fileCount).toBe(42);
    expect(c.v).toBe(1);
    expect(typeof c.updatedAt).toBe('number');
  });

  it('returns null when the cache is missing or corrupt (002 degradation)', () => {
    expect(readStatuslineCache(dir)).toBeNull();
    fs.writeFileSync(path.join(dir, '.specship', 'statusline.json'), '{ not json');
    expect(readStatuslineCache(dir)).toBeNull();
  });
});

describe('session marker (REQ-STATUSLINE-004)', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-marker-'));
    fs.mkdirSync(path.join(dir, '.specship'));
    __resetSessionGuardForTests();
  });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('initSession starts a fresh zero count', () => {
    initSession(dir);
    expect(readSessionMarker(dir)!.calls).toBe(0);
  });

  it('recordCall increments the count and records the last tool (A1/A2)', () => {
    initSession(dir);
    recordCall(dir, 'specship_explore');
    recordCall(dir, 'specship_node');
    const m = readSessionMarker(dir)!;
    expect(m.calls).toBe(2);
    expect(m.lastTool).toBe('specship_node');
    expect(typeof m.lastAt).toBe('number');
  });

  it('recordCall self-heals when no marker exists yet', () => {
    recordCall(dir, 'specship_search');
    expect(readSessionMarker(dir)!.calls).toBe(1);
  });

  it('initSession is idempotent within a process (does not reset a running count)', () => {
    initSession(dir);
    recordCall(dir, 'specship_explore');
    initSession(dir); // guard makes this a no-op
    expect(readSessionMarker(dir)!.calls).toBe(1);
  });

  it('returns null when no marker exists', () => {
    expect(readSessionMarker(dir)).toBeNull();
  });
});

describe('active-run marker (REQ-STATUSLINE-005.A4)', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-run-')); fs.mkdirSync(path.join(dir, '.specship')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('writes, reads, and clears the active run', () => {
    writeActiveRun(dir, 'REQ-STATUSLINE-002', 'awaiting-approval');
    const r = readActiveRun(dir)!;
    expect(r.specId).toBe('REQ-STATUSLINE-002');
    expect(r.status).toBe('awaiting-approval');
    clearActiveRun(dir);
    expect(readActiveRun(dir)).toBeNull();
  });
});

describe('buildSegment integration (REQ-STATUSLINE-001/002)', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-build-')); fs.mkdirSync(path.join(dir, '.specship')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('resolves the project from workspace.current_dir and renders the cache', () => {
    writeStatuslineCache(dir, {
      initialized: true,
      pending: { added: 5, modified: 0, removed: 0 },
      drift: 0, backend: 'better-sqlite3', degraded: false,
      fileCount: 10, nodeCount: 50, lastIndexed: 1,
    });
    const out = buildSegment(JSON.stringify({ workspace: { current_dir: dir } }), true);
    expect(out).toContain('5 pending');
  });

  it('works with NO database present — read path never opens SQLite (002.A2)', () => {
    // .specship/ exists with a cache but NO specship.db.
    expect(fs.existsSync(path.join(dir, '.specship', 'specship.db'))).toBe(false);
    writeStatuslineCache(dir, {
      initialized: true, pending: { added: 0, modified: 0, removed: 0 },
      drift: 0, backend: 'node-sqlite', degraded: false,
      fileCount: 1, nodeCount: 1, lastIndexed: 1,
    });
    const out = buildSegment(JSON.stringify({ workspace: { current_dir: dir } }), true);
    expect(out).toContain('synced');
  });

  it('returns an idle line (never throws) for a non-SpecShip directory', () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-bare-'));
    try {
      const out = buildSegment(JSON.stringify({ workspace: { current_dir: bare } }), true);
      expect(out).toContain('idle');
    } finally {
      fs.rmSync(bare, { recursive: true, force: true });
    }
  });

  it('does not throw on malformed stdin JSON (001.A2)', () => {
    expect(() => buildSegment('{ not valid', true)).not.toThrow();
    expect(typeof buildSegment('', true)).toBe('string');
  });
});
