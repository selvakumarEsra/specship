import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  buildSearchIntercept,
  classifyShellCommand,
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

  const advisory = { additionalContext: SEARCH_INTERCEPT_TEXT };

  describe('once per session (REQ-STEER-005.A2)', () => {
    it('fires on the first matched call and is silent on every later one', () => {
      expect(buildSearchIntercept(input())).toEqual(advisory);
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
      expect(buildSearchIntercept(input({ transcriptPath: transcript }))).toEqual(advisory);
    });

    it('a tool LISTING naming specship tools is not use — still fires', () => {
      fs.writeFileSync(transcript,
        '{"attachment":{"type":"deferred_tools_delta","addedNames":["WebFetch","mcp__specship__specship_callees","mcp__specship__specship_explore"]}}\n' +
        '{"message":{"content":[{"type":"tool_use","id":"t1","name":"Grep","input":{}}]}}\n');
      expect(buildSearchIntercept(input({ transcriptPath: transcript }))).toEqual(advisory);
    });

    it('treats an unreadable transcript as no specship use, without throwing', () => {
      expect(buildSearchIntercept(input({ transcriptPath: path.join(dir, 'nope.jsonl') })))
        .toEqual(advisory);
    });
  });

  describe('per-session isolation (REQ-STEER-005.A3)', () => {
    it('one session firing does not silence another', () => {
      expect(buildSearchIntercept(input({ sessionId: 'session-a' }))).toEqual(advisory);
      expect(buildSearchIntercept(input({ sessionId: 'session-b' }))).toEqual(advisory);
      expect(buildSearchIntercept(input({ sessionId: 'session-a' }))).toBeNull();
      expect(buildSearchIntercept(input({ sessionId: 'session-b' }))).toBeNull();
    });
  });

  describe('state pruning (REQ-STEER-005.A4)', () => {
    it('drops records older than 7 days on write', () => {
      const t0 = new Date('2026-08-01T00:00:00Z');
      const t8days = new Date('2026-08-09T00:00:01Z');
      expect(buildSearchIntercept(input({ sessionId: 'old-session', now: t0 }))).toEqual(advisory);
      expect(buildSearchIntercept(input({ sessionId: 'new-session', now: t8days }))).toEqual(advisory);
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

/**
 * Gemini CLI leg — REQ-GEMINI-011. Advisory parity with Claude, plus an
 * opt-in strict mode that denies grep_search / glob (never run_shell_command).
 * Host traits (specshipToolMarkers / transcriptFormat / supportsBeforeToolDeny)
 * are passed in by the hook I/O adapter — this suite exercises the shared
 * decision logic directly.
 */
describe('buildSearchIntercept — Gemini host', () => {
  let dir: string;
  let transcript: string;

  const geminiCaps = {
    specshipToolMarkers: ['"name":"specship__', '"name": "specship__'],
    transcriptFormat: 'single-json' as const,
  };

  const input = (overrides: Partial<Parameters<typeof buildSearchIntercept>[0]> = {}) => ({
    cwd: dir,
    sessionId: 'g-session',
    transcriptPath: null,
    env: {},
    ...geminiCaps,
    ...overrides,
  });

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'search-intercept-gemini-'));
    fs.mkdirSync(path.join(dir, '.specship'));
    transcript = path.join(dir, 'chat.json');
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe('advisory (REQ-GEMINI-011.A1)', () => {
    function geminiAdvisoryFiresOncePerSession(): void {
      expect(buildSearchIntercept(input({ denyEligible: true }))).toEqual({
        additionalContext: SEARCH_INTERCEPT_TEXT,
      });
      expect(buildSearchIntercept(input({ denyEligible: true }))).toBeNull();
    }
    it('fires once per session on grep_search in an indexed project (REQ-GEMINI-011.A1)', geminiAdvisoryFiresOncePerSession);

    it('reads Gemini single-json transcripts for specship use', () => {
      fs.writeFileSync(
        transcript,
        JSON.stringify(
          {
            messages: [
              { role: 'tool', toolCalls: [{ name: 'specship__specship_explore' }] },
            ],
          },
          null,
          2,
        ),
      );
      expect(
        buildSearchIntercept(input({ denyEligible: true, transcriptPath: transcript })),
      ).toBeNull();
    });
  });

  describe('Gemini bare tool names (REQ-GEMINI-011)', () => {
    it('counts a bare specship_* tool call in a Gemini transcript as specship use', () => {
      fs.writeFileSync(
        transcript,
        JSON.stringify({ messages: [{ role: 'gemini', toolCalls: [{ name: 'specship_explore' }] }] }, null, 2),
      );
      expect(
        buildSearchIntercept(input({ denyEligible: true, transcriptPath: transcript })),
      ).toBeNull();
    });
  });

  describe('shell classification (REQ-GEMINI-011.A2)', () => {
    const nulls = ['npm test | grep FAIL', 'git status', 'ls -la', 'cat file', 'sed -n 1,10p file'];
    const searches = ['rg "renderScene" src/', 'grep -r foo .', 'git grep bar', 'find . -name "*.ts"'];

    function geminiNonSearchShellCommandsAreIgnored(): void {
      for (const cmd of nulls) {
        expect(buildSearchIntercept(input({ shellCommand: cmd }))).toBeNull();
        expect(
          buildSearchIntercept(input({ shellCommand: cmd, strict: true, denyEligible: false })),
        ).toBeNull();
      }
    }
    it('returns null for non-search shell commands (advisory + strict) (REQ-GEMINI-011.A2)', geminiNonSearchShellCommandsAreIgnored);

    function geminiShellSearchIsAdvisoryOnly(): void {
      for (const cmd of searches) {
        const r = buildSearchIntercept(
          input({ shellCommand: cmd, sessionId: `s-${cmd}` }),
        );
        expect(r).toEqual({ additionalContext: SEARCH_INTERCEPT_TEXT });
      }
      // Strict never denies a shell runner (REQ-GEMINI-011.A3).
      for (const cmd of searches) {
        const r = buildSearchIntercept(
          input({ shellCommand: cmd, strict: true, denyEligible: false, sessionId: `strict-${cmd}` }),
        );
        if (r) expect('decision' in r).toBe(false);
      }
    }
    it('search-shaped shell commands get the advisory line, NEVER a deny (REQ-GEMINI-011.A3)', geminiShellSearchIsAdvisoryOnly);

    it('classifyShellCommand splits on top-level pipeline operators only', () => {
      expect(classifyShellCommand('rg foo')).toBe('search');
      expect(classifyShellCommand('git grep foo')).toBe('search');
      expect(classifyShellCommand('npm test | grep FAIL')).toBe('other');
      expect(classifyShellCommand('ls && rg foo')).toBe('other');
      expect(classifyShellCommand('ls; grep foo')).toBe('other');
      expect(classifyShellCommand('cat x')).toBe('other');
      expect(classifyShellCommand('sed -n 1p file')).toBe('other');
    });
  });

  describe('strict mode (REQ-GEMINI-011.A3)', () => {
    function geminiStrictDeniesBuiltinSearch(): void {
      fs.writeFileSync(transcript, JSON.stringify({ messages: [] }));
      const r = buildSearchIntercept(
        input({ strict: true, denyEligible: true, transcriptPath: transcript, searchPattern: 'renderScene' }),
      );
      expect(r).not.toBeNull();
      if (r && 'decision' in r) {
        expect(r.decision).toBe('deny');
        expect(r.reason).toContain('specship_explore');
        expect(r.reason).toContain('renderScene');
      } else {
        throw new Error('expected deny result');
      }
    }
    it('denies grep_search / glob with a reason naming specship_explore (REQ-GEMINI-011.A3)', geminiStrictDeniesBuiltinSearch);

    function geminiStrictAllowsUnindexedProject(): void {
      const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'search-intercept-gemini-bare-'));
      try {
        fs.writeFileSync(path.join(bare, 'chat.json'), JSON.stringify({ messages: [] }));
        expect(
          buildSearchIntercept(
            input({
              cwd: bare,
              strict: true,
              denyEligible: true,
              transcriptPath: path.join(bare, 'chat.json'),
            }),
          ),
        ).toBeNull();
      } finally {
        fs.rmSync(bare, { recursive: true, force: true });
      }
    }
    it('ALLOWs when the project is unindexed (REQ-GEMINI-011.A3)', geminiStrictAllowsUnindexedProject);

    function geminiStrictAllowsUnreadableTranscript(): void {
      fs.writeFileSync(transcript, '{ not json');
      expect(
        buildSearchIntercept(
          input({ strict: true, denyEligible: true, transcriptPath: transcript }),
        ),
      ).toBeNull();
    }
    it('ALLOWs when the transcript cannot be parsed (REQ-GEMINI-011.A3)', geminiStrictAllowsUnreadableTranscript);

    it('ALLOWs when the transcript shows the session already used specship', () => {
      fs.writeFileSync(
        transcript,
        JSON.stringify({ messages: [{ toolCalls: [{ name: 'specship__specship_explore' }] }] }),
      );
      expect(
        buildSearchIntercept(
          input({ strict: true, denyEligible: true, transcriptPath: transcript }),
        ),
      ).toBeNull();
    });
  });

  describe('no decision when strict is unset (REQ-GEMINI-011.A4)', () => {
    function geminiNoDecisionWithoutStrict(): void {
      fs.writeFileSync(transcript, JSON.stringify({ messages: [] }));
      const fixtures = [
        { denyEligible: true },
        { denyEligible: true, transcriptPath: transcript },
        { denyEligible: false, shellCommand: 'rg foo' },
        { denyEligible: false, shellCommand: 'npm test | grep FAIL' },
        { denyEligible: false, shellCommand: 'git status' },
      ];
      for (const f of fixtures) {
        const r = buildSearchIntercept(input({ ...f, sessionId: `s-${JSON.stringify(f)}` }));
        if (r) expect('decision' in r).toBe(false);
      }
    }
    it('across every tool/command combination (REQ-GEMINI-011.A4)', geminiNoDecisionWithoutStrict);
  });
});

/**
 * REQ-GEMINI-011.A5 — the docs must not promise that either mode removes
 * Gemini's shell confirmation prompt (BeforeTool fires after it), and must
 * scope strict mode to the built-in search tools.
 */
function geminiDocsStateShellPromptRemains(): void {
  const doc = fs.readFileSync(
    path.join(__dirname, '..', 'site', 'src', 'content', 'docs', 'claude-code', 'steering.md'),
    'utf-8',
  );
  expect(doc).toMatch(/Neither mode suppresses Gemini's shell confirmation prompt/);
  expect(doc).toMatch(/SPECSHIP_GEMINI_STRICT/);
  expect(doc).toMatch(/grep_search/);
}

describe('Gemini interceptor docs (REQ-GEMINI-011)', () => {
  it('docs say the shell confirmation prompt remains (REQ-GEMINI-011.A5)', geminiDocsStateShellPromptRemains);
});
