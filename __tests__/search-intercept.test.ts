import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  buildSearchIntercept,
  interceptStatePath,
  SEARCH_INTERCEPT_TEXT,
} from '../src/activation/search-intercept';

/**
 * STEER-HOOK-DOC (specs/retrieval-steering-hook.md) — the search-intercept
 * PreToolUse hook command's decision logic: advisory redirect at the moment
 * of a search-shaped call (REQ-STEER-004), at most once per session and only
 * for sessions that haven't used specship (REQ-STEER-005).
 */

describe('buildSearchIntercept', () => {
  let dir: string;
  let transcript: string;

  const input = (overrides: Partial<Parameters<typeof buildSearchIntercept>[0]> = {}) => ({
    cwd: dir,
    sessionId: 'session-a',
    transcriptPath: null,
    env: {},
    ...overrides,
  });

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'search-intercept-'));
    fs.mkdirSync(path.join(dir, '.specship'));
    transcript = path.join(dir, 'transcript.jsonl');
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe('silence gates (REQ-STEER-004.A3)', () => {
    it('emits nothing in a directory without .specship/', () => {
      const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'search-intercept-bare-'));
      try {
        expect(buildSearchIntercept(input({ cwd: bare }))).toBeNull();
      } finally {
        fs.rmSync(bare, { recursive: true, force: true });
      }
    });

    it('emits nothing with SPECSHIP_NO_STEERING=1 in an initialized project', () => {
      expect(buildSearchIntercept(input({ env: { SPECSHIP_NO_STEERING: '1' } }))).toBeNull();
    });

    it('emits nothing when the payload carried no session id', () => {
      // No key for the once-per-session guarantee → silence beats repeat-firing.
      expect(buildSearchIntercept(input({ sessionId: null }))).toBeNull();
    });
  });

  describe('once per session (REQ-STEER-005.A2)', () => {
    it('fires on the first matched call and is silent on every later one', () => {
      expect(buildSearchIntercept(input())).toBe(SEARCH_INTERCEPT_TEXT);
      expect(buildSearchIntercept(input())).toBeNull();
      expect(buildSearchIntercept(input())).toBeNull();
    });
  });

  describe('specship-using sessions (REQ-STEER-005.A1)', () => {
    it('is silent when the transcript shows a specship tool call', () => {
      fs.writeFileSync(transcript,
        '{"message":{"content":[{"type":"tool_use","id":"t1","name":"mcp__specship__specship_explore","input":{}}]}}\n');
      expect(buildSearchIntercept(input({ transcriptPath: transcript }))).toBeNull();
      // And the silence is recorded — later calls stay silent without a rescan.
      fs.rmSync(transcript);
      expect(buildSearchIntercept(input({ transcriptPath: transcript }))).toBeNull();
    });

    it('fires when the transcript has no specship use', () => {
      fs.writeFileSync(transcript, '{"tool":"Grep"}\n{"tool":"Read"}\n');
      expect(buildSearchIntercept(input({ transcriptPath: transcript }))).toBe(SEARCH_INTERCEPT_TEXT);
    });

    it('a tool LISTING naming specship tools is not use — still fires', () => {
      // Transcripts carry the available-tools list (deferred_tools_delta) in
      // every session where specship is installed; treating a name mention as
      // use silenced the interceptor in 100% of sessions (found in the
      // REQ-STEER-006 A/B). Only a tool_use record counts.
      fs.writeFileSync(transcript,
        '{"attachment":{"type":"deferred_tools_delta","addedNames":["WebFetch","mcp__specship__specship_callees","mcp__specship__specship_explore"]}}\n' +
        '{"message":{"content":[{"type":"tool_use","id":"t1","name":"Grep","input":{}}]}}\n');
      expect(buildSearchIntercept(input({ transcriptPath: transcript }))).toBe(SEARCH_INTERCEPT_TEXT);
    });

    it('treats an unreadable transcript as no specship use, without throwing', () => {
      expect(buildSearchIntercept(input({ transcriptPath: path.join(dir, 'nope.jsonl') })))
        .toBe(SEARCH_INTERCEPT_TEXT);
    });
  });

  describe('per-session isolation (REQ-STEER-005.A3)', () => {
    it('one session firing does not silence another', () => {
      expect(buildSearchIntercept(input({ sessionId: 'session-a' }))).toBe(SEARCH_INTERCEPT_TEXT);
      expect(buildSearchIntercept(input({ sessionId: 'session-b' }))).toBe(SEARCH_INTERCEPT_TEXT);
      expect(buildSearchIntercept(input({ sessionId: 'session-a' }))).toBeNull();
      expect(buildSearchIntercept(input({ sessionId: 'session-b' }))).toBeNull();
    });
  });

  describe('state pruning (REQ-STEER-005.A4)', () => {
    it('drops records older than 7 days on write', () => {
      const t0 = new Date('2026-08-01T00:00:00Z');
      const t8days = new Date('2026-08-09T00:00:01Z');
      expect(buildSearchIntercept(input({ sessionId: 'old-session', now: t0 }))).toBe(SEARCH_INTERCEPT_TEXT);
      expect(buildSearchIntercept(input({ sessionId: 'new-session', now: t8days }))).toBe(SEARCH_INTERCEPT_TEXT);
      const state = JSON.parse(fs.readFileSync(interceptStatePath(dir), 'utf-8'));
      expect(state['old-session']).toBeUndefined();
      expect(state['new-session']).toBeDefined();
    });
  });

  describe('advisory robustness (REQ-STEER-004.A2)', () => {
    it('never throws on a corrupt state file', () => {
      fs.writeFileSync(interceptStatePath(dir), '{not json');
      expect(() => buildSearchIntercept(input())).not.toThrow();
      expect(buildSearchIntercept(input({ sessionId: 'after-corrupt' }))).not.toBeNull();
    });

    it('emits guidance text only — no permission-decision vocabulary', () => {
      // The CLI wraps this in additionalContext; the text itself must never
      // read as (or contain) a deny/block decision.
      expect(SEARCH_INTERCEPT_TEXT).not.toMatch(/permissionDecision|"deny"|"block"/);
      expect(SEARCH_INTERCEPT_TEXT).toContain('specship_explore');
      expect(SEARCH_INTERCEPT_TEXT).toMatch(/still runs/);
    });
  });
});
