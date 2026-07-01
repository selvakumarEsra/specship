/**
 * Context-usage bar + compaction warning — REQ-STATUSLINE-009.
 *
 * SpecShip can't compact (the host owns that) — it surfaces context pressure so
 * the user compacts before things get inefficient. Reads Claude's real
 * `context_window.used_percentage` from the status-line stdin; escalates to a
 * warning + `⚠ compact` hint at/above a configurable threshold
 * (`SPECSHIP_CTX_WARN_PCT`, default 80). Advisory only.
 */

import { describe, it, expect } from 'vitest';
import { contextFromStatuslineInput, resolveCtxWarnPct } from '../src/statusline/usage-limits';
import { renderSegment } from '../src/statusline/render';

const ESC = String.fromCharCode(27);

function input(context_window: unknown): string {
  return JSON.stringify({ workspace: { current_dir: '/x' }, context_window });
}

describe('REQ-STATUSLINE-009 — contextFromStatuslineInput', () => {
  it('returns used_percentage when present', () => {
    expect(contextFromStatuslineInput(input({ used_percentage: 78 }))).toBe(78);
  });
  it('returns null when context_window is absent', () => {
    expect(contextFromStatuslineInput(JSON.stringify({ workspace: { current_dir: '/x' } }))).toBeNull();
  });
  it('returns null when used_percentage is null (early session)', () => {
    expect(contextFromStatuslineInput(input({ used_percentage: null }))).toBeNull();
  });
  it('returns null on unparseable input', () => {
    expect(contextFromStatuslineInput('{ nope')).toBeNull();
  });
});

describe('REQ-STATUSLINE-009 — resolveCtxWarnPct', () => {
  it('defaults to 80 when unset', () => {
    expect(resolveCtxWarnPct(undefined)).toBe(80);
  });
  it('honors a valid override', () => {
    expect(resolveCtxWarnPct('70')).toBe(70);
  });
  it('falls back to 80 on non-numeric', () => {
    expect(resolveCtxWarnPct('abc')).toBe(80);
  });
  it('falls back to 80 on out-of-range', () => {
    expect(resolveCtxWarnPct('150')).toBe(80);
  });
});

describe('REQ-STATUSLINE-009 — renderSegment CTX element', () => {
  const base = { cache: null, marker: null, run: null, noColor: true } as const;

  it('shows a CTX bar with the percentage below threshold, no warning (A1/A2)', () => {
    const line = renderSegment({ ...base, context: 42, ctxWarnPct: 80 });
    expect(line).toContain('CTX');
    expect(line).toContain('42%');
    expect(line).not.toContain('compact');
    expect(line).toMatch(/[❮▰▱❯]/);
  });

  it('escalates with a compaction hint at/above threshold (A2)', () => {
    const line = renderSegment({ ...base, context: 85, ctxWarnPct: 80 });
    expect(line).toContain('CTX');
    expect(line).toContain('85%');
    expect(line).toContain('compact');
  });

  it('omits the CTX element entirely when context is absent (A4)', () => {
    const line = renderSegment({ ...base });
    expect(line).not.toContain('CTX');
  });

  it('emits no ANSI under NO_COLOR (A5)', () => {
    const line = renderSegment({ ...base, context: 85, ctxWarnPct: 80 });
    expect(line).not.toContain(ESC);
  });
});
