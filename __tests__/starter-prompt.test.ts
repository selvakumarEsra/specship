/**
 * First-run starter-prompt selection (REQ-ACTIVATION-001).
 *
 * The graph access is behind an injectable GraphProbe so the selection policy
 * and prompt formatting are tested deterministically; the real probe (which
 * walks the live graph and excludes god-files) is exercised by an integration
 * test against this repo's own index.
 */

import { describe, it, expect } from 'vitest';
import {
  selectStarterPrompt,
  isNoiseName,
  isUninterestingFile,
  type GraphProbe,
} from '../src/activation/starter-prompt';

function probe(overrides: Partial<GraphProbe>): GraphProbe {
  return {
    entryCandidates: () => [],
    traceFlow: () => null,
    topFanInSymbol: () => null,
    ...overrides,
  };
}

describe('selectStarterPrompt (REQ-ACTIVATION-001)', () => {
  it('returns a flow prompt naming both endpoints when a multi-file flow exists', () => {
    const r = selectStarterPrompt(
      probe({
        entryCandidates: () => [{ name: 'handleRequest', file: 'a.ts' }],
        traceFlow: () => ({ to: 'writeRow', hops: 4, files: ['a.ts', 'b.ts', 'c.ts'], synthesized: false }),
      })
    );
    expect(r).toEqual({
      kind: 'flow',
      from: 'handleRequest',
      to: 'writeRow',
      prompt: 'How does `handleRequest` reach `writeRow`?',
    });
  });

  it('rejects a flow that does not cross at least two files (A2) and falls back to impact', () => {
    const r = selectStarterPrompt(
      probe({
        entryCandidates: () => [{ name: 'foo', file: 'a.ts' }],
        traceFlow: () => ({ to: 'bar', hops: 3, files: ['a.ts'], synthesized: false }),
        topFanInSymbol: () => ({ name: 'logger', file: 'log.ts' }),
      })
    );
    expect(r).toEqual({ kind: 'impact', from: 'logger', prompt: 'What breaks if I change `logger`?' });
  });

  it('rejects a trivial single-hop flow (A2 multi-hop) and falls back to impact', () => {
    const r = selectStarterPrompt(
      probe({
        entryCandidates: () => [{ name: 'foo', file: 'a.ts' }],
        traceFlow: () => ({ to: 'bar', hops: 1, files: ['a.ts', 'b.ts'], synthesized: false }),
        topFanInSymbol: () => ({ name: 'db', file: 'db.ts' }),
      })
    );
    expect(r!.kind).toBe('impact');
  });

  it('uses the first candidate that yields a valid flow', () => {
    const r = selectStarterPrompt(
      probe({
        entryCandidates: () => [
          { name: 'noFlow', file: 'a.ts' },
          { name: 'goodEntry', file: 'b.ts' },
        ],
        traceFlow: (e) =>
          e.name === 'goodEntry' ? { to: 'sink', hops: 3, files: ['b.ts', 'c.ts'], synthesized: true } : null,
        topFanInSymbol: () => ({ name: 'never', file: 'x.ts' }),
      })
    );
    expect(r).toMatchObject({ kind: 'flow', from: 'goodEntry', to: 'sink' });
  });

  it('falls back to an impact prompt when no flow connects (A4)', () => {
    const r = selectStarterPrompt(
      probe({
        entryCandidates: () => [{ name: 'foo', file: 'a.ts' }],
        traceFlow: () => null,
        topFanInSymbol: () => ({ name: 'Config', file: 'config.ts' }),
      })
    );
    expect(r).toEqual({ kind: 'impact', from: 'Config', prompt: 'What breaks if I change `Config`?' });
  });

  it('returns null on an empty graph (A5)', () => {
    expect(selectStarterPrompt(probe({}))).toBeNull();
  });
});

describe('endpoint quality filters (human-facing precision bar)', () => {
  it('treats name-collision artifacts and very short names as noise', () => {
    for (const n of ['all', 'set', 'now', 'get', 'find', 'a', 'fn']) {
      expect(isNoiseName(n)).toBe(true);
    }
  });

  it('keeps meaningful symbol names', () => {
    for (const n of ['runSmokeCheck', 'authenticate', 'renderStaticScene', 'placeBracketOrder']) {
      expect(isNoiseName(n)).toBe(false);
    }
  });

  it('flags test / fixture / build files as uninteresting endpoints', () => {
    for (const f of [
      '__tests__/foo.ts',
      'src/auth/login.test.ts',
      'test/helpers.ts',
      'fixtures/data.ts',
      'dist/bin/specship.js',
    ]) {
      expect(isUninterestingFile(f)).toBe(true);
    }
  });

  it('keeps real source files', () => {
    for (const f of ['src/auth/login.ts', 'src/health/smoke-check.ts']) {
      expect(isUninterestingFile(f)).toBe(false);
    }
  });
});
