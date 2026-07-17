import { describe, it, expect } from 'vitest';
import { CHEATSHEET_TEXT, buildCheatsheetPayload } from '../src/activation/cheatsheet';

/**
 * CHEATSHEET-DOC — the `specship cheatsheet` command prints a user-visible
 * session cheat-sheet as a SessionStart-hook systemMessage. These cover the
 * message contract (REQ-CHEAT-001), the content surfaces (REQ-CHEAT-002), and
 * the env opt-out (REQ-CHEAT-004). Frequency (startup-only) and installer
 * wiring live in installer-targets.test.ts.
 */
describe('cheatsheet payload (REQ-CHEAT-001)', () => {
  it('returns a systemMessage payload with non-empty text (A1)', () => {
    const payload = buildCheatsheetPayload({});
    expect(payload).not.toBeNull();
    expect(typeof payload!.systemMessage).toBe('string');
    expect(payload!.systemMessage.length).toBeGreaterThan(0);
  });

  it('carries no agent-context field — human-only, not injected into context (A2)', () => {
    const payload = buildCheatsheetPayload({});
    expect(payload).not.toBeNull();
    expect(Object.keys(payload!)).toEqual(['systemMessage']);
    expect((payload as Record<string, unknown>).additionalContext).toBeUndefined();
    expect((payload as Record<string, unknown>).hookSpecificOutput).toBeUndefined();
  });
});

describe('cheatsheet content covers the core surfaces (REQ-CHEAT-002)', () => {
  it('references all four doors — explore, spec, check, learn (A1)', () => {
    for (const door of ['explore', 'spec', 'check', 'learn']) {
      expect(CHEATSHEET_TEXT.toLowerCase()).toContain(door);
    }
  });

  it('references retrieval, JIRA, drift/health, lessons/memory, and verify (A2)', () => {
    const lower = CHEATSHEET_TEXT.toLowerCase();
    expect(lower).toContain('specship_explore'); // explore-first retrieval
    expect(lower).toContain('jira');
    expect(lower).toContain('drift');
    expect(lower).toContain('health');
    expect(lower).toContain('memory');
    expect(lower).toContain('verify');
  });

  it('names only user-facing surfaces — no internal paths, symbols, or benchmarks (A3)', () => {
    expect(CHEATSHEET_TEXT).not.toMatch(/src\//);
    expect(CHEATSHEET_TEXT).not.toMatch(/\.ts\b/);
    expect(CHEATSHEET_TEXT).not.toMatch(/\d+%/); // no benchmark percentages
  });
});

describe('cheatsheet env opt-out (REQ-CHEAT-004)', () => {
  it('is silent when SPECSHIP_NO_CHEATSHEET is set (A1)', () => {
    expect(buildCheatsheetPayload({ SPECSHIP_NO_CHEATSHEET: '1' })).toBeNull();
  });

  it('prints when the variable is unset or empty (A2)', () => {
    expect(buildCheatsheetPayload({})).not.toBeNull();
    expect(buildCheatsheetPayload({ SPECSHIP_NO_CHEATSHEET: '' })).not.toBeNull();
  });
});
