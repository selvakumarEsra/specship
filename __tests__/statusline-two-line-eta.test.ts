/**
 * REQ-STATUSLINE-010 (two-line layout) + REQ-STATUSLINE-011 (run ETA element)
 * — specs/statusline.md.
 *
 * Pure renderSegment tests plus the active-run marker round-trip with the
 * embedded estimate. Still no database anywhere: the estimate is computed by
 * the executor at marker-write time (WORKFLOW-ETA-DOC), the renderer only
 * formats what the marker carries.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { renderSegment } from '../src/statusline/render';
import { writeActiveRun, readActiveRun } from '../src/statusline/active-run';
import { StatuslineCache, ActiveRun } from '../src/statusline/types';

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

const base = { cache: fullCache(), marker: null, run: null, noColor: true } as const;

describe('two-line layout (REQ-STATUSLINE-010)', () => {
  it('A1: telemetry moves to a second line; SpecShip elements stay on the first', () => {
    const out = renderSegment({
      ...base,
      context: 12,
      usage: { session: { pctUsed: 60, resetAt: 2_000_000 }, weekly: { pctUsed: 30, resetAt: 3_000_000 } },
      now: 1_000_000,
    });
    const lines = out.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('specship');
    expect(lines[0]).toContain('synced');
    expect(lines[0]).not.toContain('CTX');
    expect(lines[1]).toContain('CTX');
    expect(lines[1]).toContain('5h');
    expect(lines[1]).toContain('7d');
    expect(lines[1]).not.toContain('specship');
    // Same ornament framing on both lines.
    expect(lines[1]!.startsWith('◈ ')).toBe(true);
    expect(lines[1]!.endsWith(' ◈')).toBe(true);
  });

  it('A2: no telemetry → a single line with no newline', () => {
    const out = renderSegment({ ...base });
    expect(out).not.toContain('\n');
    expect(out).toContain('specship');
  });
});

describe('run ETA element (REQ-STATUSLINE-011)', () => {
  const run = (eta?: ActiveRun['eta']): ActiveRun => ({
    v: 1,
    specId: 'REQ-X-001',
    status: 'running',
    updatedAt: 1,
    ...(eta ? { eta } : {}),
  });

  it('A1: a range estimate renders as a compact ≈low–high suffix', () => {
    const out = renderSegment({
      ...base,
      run: run({ kind: 'range', lowMs: 4 * 60_000, highMs: 11 * 60_000 }),
    });
    expect(out).toContain('REQ-X-001·running ≈4m–11m left');
  });

  it('A1: equal bounds collapse to one value', () => {
    const out = renderSegment({
      ...base,
      run: run({ kind: 'range', lowMs: 9 * 60_000, highMs: 9 * 60_000 }),
    });
    expect(out).toContain('≈9m left');
    expect(out).not.toContain('–');
  });

  it('A2: a waiting estimate renders "waiting on you"', () => {
    const out = renderSegment({
      ...base,
      run: { ...run({ kind: 'waiting', sinceMs: 42 }), status: 'paused' },
    });
    expect(out).toContain('REQ-X-001·paused waiting on you');
  });

  it('A3: a marker without an estimate renders the run element unchanged', () => {
    const out = renderSegment({ ...base, run: run() });
    expect(out).toContain('REQ-X-001·running');
    expect(out).not.toContain('≈');
    expect(out).not.toContain('waiting');
  });

  it('hour-scale ranges format compactly', () => {
    const out = renderSegment({
      ...base,
      run: run({ kind: 'range', lowMs: 80 * 60_000, highMs: 135 * 60_000 }),
    });
    expect(out).toContain('≈1h20m–2h15m left');
  });
});

describe('active-run marker round-trip with eta', () => {
  let dir: string;
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('persists and restores the embedded estimate', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-eta-'));
    fs.mkdirSync(path.join(dir, '.specship'), { recursive: true });
    writeActiveRun(dir, 'REQ-X-001', 'running', { kind: 'range', lowMs: 1000, highMs: 2000 });
    const back = readActiveRun(dir);
    expect(back?.eta).toEqual({ kind: 'range', lowMs: 1000, highMs: 2000 });
  });

  it('older-style writes without eta read back without one', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-eta-'));
    fs.mkdirSync(path.join(dir, '.specship'), { recursive: true });
    writeActiveRun(dir, null, 'running');
    const back = readActiveRun(dir);
    expect(back?.eta).toBeUndefined();
  });
});
