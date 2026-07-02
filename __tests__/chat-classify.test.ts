/**
 * Unit tests for the deterministic chat intent classifier (REQ-DASH-CHAT-002).
 *
 * `classifyIntent` is a **pure** function of the message text (A4) — no `cg`,
 * no I/O, no model — so it is exercised in isolation with plain strings.
 *
 *   A1 — each slash command routes to its intent with the right query.
 *   A2 — free-form phrasings route to callers / impact / explore / domain.
 *   A3 — an unmatched message falls back to search (never null, confident:false).
 *   A4 — same input → identical output (pure).
 *   A5 — every launch intent is reachable, including callees and drift.
 */

import { describe, it, expect } from 'vitest';
import { classifyIntent } from '../packages/server/src/chat/classify';
import type { ChatIntent } from '../packages/server/src/chat/classify';

// ---------------------------------------------------------------------------
// A1: slash commands route explicitly.
// ---------------------------------------------------------------------------
describe('slash commands (A1)', () => {
  it('/ss-spec <ID> routes to spec with the id as query', () => {
    const c = classifyIntent('/ss-spec REQ-DASH-CHAT-002');
    expect(c.intent).toBe('spec');
    expect(c.query).toBe('REQ-DASH-CHAT-002');
    expect(c.confident).toBe(true);
  });

  it('/ss-explore <symbols> routes to explore with the symbol bag as query', () => {
    const c = classifyIntent('/ss-explore LedgerService recordEntry');
    expect(c.intent).toBe('explore');
    expect(c.query).toBe('LedgerService recordEntry');
    expect(c.confident).toBe(true);
  });

  it('/ss-check … routes to drift (the check family has no separate health intent)', () => {
    const c = classifyIntent('/ss-check');
    expect(c.intent).toBe('drift');
    expect(c.confident).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// CMD-NS-DOC REQ-CMD-NS-005: the canonical `/specship:*` forms route, and the
// legacy `/ss-*` forms still route but are flagged as a deprecated alias.
// ---------------------------------------------------------------------------
describe('command namespace (CMD-NS-DOC, REQ-CMD-NS-005)', () => {
  it('/specship:spec <ID> routes to spec with no deprecation flag', () => {
    const c = classifyIntent('/specship:spec REQ-DASH-CHAT-002');
    expect(c.intent).toBe('spec');
    expect(c.query).toBe('REQ-DASH-CHAT-002');
    expect(c.confident).toBe(true);
    expect(c.deprecatedAlias).toBeUndefined();
  });

  it('/specship:explore <symbols> routes to explore', () => {
    const c = classifyIntent('/specship:explore LedgerService recordEntry');
    expect(c.intent).toBe('explore');
    expect(c.query).toBe('LedgerService recordEntry');
  });

  it('/specship:check routes to drift', () => {
    expect(classifyIntent('/specship:check').intent).toBe('drift');
  });

  it('legacy /ss-spec still routes but is flagged as renamed to /specship:spec', () => {
    const c = classifyIntent('/ss-spec REQ-LEDGER-001');
    expect(c.intent).toBe('spec');
    expect(c.query).toBe('REQ-LEDGER-001');
    expect(c.deprecatedAlias).toEqual({ from: '/ss-spec', to: '/specship:spec' });
  });

  it('legacy /ss-explore and /ss-check carry their rename targets', () => {
    expect(classifyIntent('/ss-explore foo').deprecatedAlias).toEqual({ from: '/ss-explore', to: '/specship:explore' });
    expect(classifyIntent('/ss-check').deprecatedAlias).toEqual({ from: '/ss-check', to: '/specship:check' });
  });
});

// ---------------------------------------------------------------------------
// A2 / A5: free-form phrasings route to the matching capability.
// ---------------------------------------------------------------------------
describe('free-form routing (A2, A5)', () => {
  const cases: Array<{ msg: string; intent: ChatIntent; subject?: string }> = [
    { msg: 'who calls recordEntry', intent: 'callers', subject: 'recordEntry' },
    { msg: 'what calls recordEntry', intent: 'callers', subject: 'recordEntry' },
    { msg: 'what does LedgerService call', intent: 'callees', subject: 'LedgerService' },
    { msg: 'callees of LedgerService', intent: 'callees' },
    { msg: 'what breaks if I change recordEntry', intent: 'impact', subject: 'recordEntry' },
    { msg: 'impact of recordEntry', intent: 'impact', subject: 'recordEntry' },
    { msg: 'how does recordEntry work', intent: 'explore', subject: 'recordEntry' },
    { msg: 'trace mutateElement renderScene', intent: 'explore' },
    { msg: "what's drifted", intent: 'drift' },
    { msg: 'show me drift', intent: 'drift' },
    { msg: 'what is a Ledger', intent: 'domain', subject: 'Ledger' },
    { msg: 'define Ledger', intent: 'domain', subject: 'Ledger' },
    { msg: 'REQ-LEDGER-001', intent: 'spec', subject: 'REQ-LEDGER-001' },
  ];

  for (const { msg, intent, subject } of cases) {
    it(`"${msg}" → ${intent}`, () => {
      const c = classifyIntent(msg);
      expect(c.intent).toBe(intent);
      expect(c.confident).toBe(true);
      if (subject !== undefined) expect(c.query).toBe(subject);
    });
  }

  it('every launch intent is reachable from some message (A5)', () => {
    const reached = new Set(cases.map((c) => c.intent));
    // callers, callees, impact, explore, drift, domain, spec above; search below.
    reached.add(classifyIntent('total gibberish zzz').intent);
    const launch: ChatIntent[] = ['spec', 'explore', 'callers', 'callees', 'impact', 'drift', 'domain', 'search'];
    for (const i of launch) expect(reached.has(i)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// A3: unmatched → search fallback (never null, never a guessed intent).
// ---------------------------------------------------------------------------
describe('fallback (A3)', () => {
  it('an unmatched message falls back to search with confident:false', () => {
    const c = classifyIntent('lorem ipsum dolor sit');
    expect(c.intent).toBe('search');
    expect(c.confident).toBe(false);
  });

  it('never returns a nullish intent', () => {
    for (const msg of ['', '   ', '???', 'hello there']) {
      const c = classifyIntent(msg);
      expect(c).toBeTruthy();
      expect(typeof c.intent).toBe('string');
    }
  });
});

// ---------------------------------------------------------------------------
// A4: pure — same input → identical output.
// ---------------------------------------------------------------------------
describe('purity (A4)', () => {
  it('produces identical output for identical input', () => {
    const a = classifyIntent('what breaks if I change recordEntry');
    const b = classifyIntent('what breaks if I change recordEntry');
    expect(b).toEqual(a);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});
