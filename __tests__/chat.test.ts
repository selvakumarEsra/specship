/**
 * Tests for the deterministic dashboard chat (REQ-DASH-CHAT-001).
 *
 * Builds a real temp project, initializes SpecShip, indexes source + spec +
 * domain files, then exercises both the pure answer core (`chat-answer.ts`)
 * and the `POST /api/chat` route via Fastify's `.inject()` (no network).
 * Mirrors `domain-endpoint.test.ts`.
 *
 *   A1     — every returned source maps to a row present in the seeded index.
 *   A2     — the route/core modules import nothing LLM-shaped (source scan).
 *   A3     — same index + same question → byte-identical answer across calls.
 *   A4     — an absent subject → found:false, no invented symbol/path/fact.
 *   route  — 409 no-project, 400 empty question, 200 shape.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import Fastify from 'fastify';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import SpecShip from '../src/index';
import { registerChatRoutes } from '../packages/server/src/routes/chat';
import { answerFromKnowledgeBase, answerForIntent, extractSubject, chunkAnswer } from '../packages/server/src/routes/chat-answer';
import { classifyIntent } from '../packages/server/src/chat/classify';

// ---------------------------------------------------------------------------
// FTS5 guard — identical pattern used across the spec test suite. Search-driven
// answering needs FTS5, so skip the integration block when it's unavailable.
// ---------------------------------------------------------------------------
const fts5Available = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require('better-sqlite3');
    const db = new Database(':memory:');
    try { db.exec('CREATE VIRTUAL TABLE _probe USING fts5(x)'); db.close(); return true; }
    catch { db.close(); }
  } catch { /* fall through */ }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(':memory:');
    try { db.exec('CREATE VIRTUAL TABLE _probe USING fts5(x)'); db.close(); return true; }
    catch { db.close(); }
  } catch { /* fall through */ }
  return false;
})();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'chat-endpoint-'));
}
function clean(d: string): void {
  if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
}

/**
 * Minimal Fastify app: decorate `activeCg` to return the supplied SpecShip
 * instance (or null so the 409 branch fires), then register the chat route.
 */
async function buildTestApp(cg: SpecShip | null): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.decorate('activeCg', async function (_req: FastifyRequest): Promise<SpecShip | null> {
    return cg;
  });
  await registerChatRoutes(app);
  await app.ready();
  return app;
}

/** Seed a temp project with one symbol file, one requirement spec, one domain fact. */
function seedProject(dir: string): void {
  const src = path.join(dir, 'src');
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(path.join(src, 'ledger.ts'), `
export function recordEntry(amount: number): void {
  // append an entry to the ledger
}

export class LedgerService {
  post(amount: number): void { recordEntry(amount); }
}
`, 'utf-8');

  const specDir = path.join(dir, 'specs');
  fs.mkdirSync(specDir, { recursive: true });
  fs.writeFileSync(path.join(specDir, 'ledger.md'), `---
id: REQ-LEDGER-001
kind: requirement
title: The ledger records entries
---
<!-- id: REQ-LEDGER-001 -->
# The ledger records entries

Each posting appends one entry via recordEntry.
`, 'utf-8');

  const domainDir = path.join(specDir, 'domain');
  fs.mkdirSync(domainDir, { recursive: true });
  fs.writeFileSync(path.join(domainDir, 'glossary.md'), `---
id: DOMAIN-LEDGER
kind: domain
type: term
title: Ledger
---
<!-- id: DOMAIN-LEDGER -->
# Ledger

A ledger is the append-only record of balance changes.
`, 'utf-8');
}

// ---------------------------------------------------------------------------
// A2: static source scan — no runtime import of the package, nothing LLM-shaped.
// ---------------------------------------------------------------------------
describe('chat modules source (REQ-DASH-CHAT-001.A2)', () => {
  const files = ['chat.ts', 'chat-answer.ts'].map((f) =>
    path.join(__dirname, '..', 'packages', 'server', 'src', 'routes', f),
  );

  it('bare-imports nothing from @specship/specship', () => {
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf-8');
      // A value import would silently serve a stale build; type-only is fine
      // but these modules use neither.
      expect(source).not.toMatch(/^\s*import\s+\{[^}]*\}\s+from\s+['"]@specship\/specship['"]/m);
    }
  });

  it('imports nothing LLM/inference-shaped and reads no model credentials', () => {
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf-8');
      // No SDK/model imports.
      expect(source).not.toMatch(/from\s+['"](openai|@anthropic-ai\/|@anthropic-ai\/sdk|@google\/generative-ai|cohere-ai|langchain)/);
      // No network egress primitives.
      expect(source).not.toMatch(/\bfetch\s*\(|\bhttps?\.request\b|\bnew\s+WebSocket\b/);
      // No model-credential env reads.
      expect(source).not.toMatch(/process\.env\.\w*(?:API_KEY|OPENAI|ANTHROPIC|GEMINI|TOKEN)\w*/i);
    }
  });
});

// ---------------------------------------------------------------------------
// Pure subject extraction — no I/O, unit-testable in isolation.
// ---------------------------------------------------------------------------
describe('extractSubject (pure)', () => {
  it('drops question words and keeps the identifier subject', () => {
    expect(extractSubject('how does recordEntry work').query).toBe('recordEntry');
  });
  it('strips a leading slash-command token', () => {
    expect(extractSubject('/ss-explore LedgerService recordEntry').query).toBe('LedgerService recordEntry');
  });
  it('is a pure function of its input (same input → same output)', () => {
    const a = extractSubject('what is a Ledger');
    const b = extractSubject('what is a Ledger');
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// chunkAnswer — pure presentation chunker for faux-streaming (REQ-DASH-CHAT-003).
// The one hard invariant: chunks.join('') === answer (A2/A3), so pacing never
// alters content. Deterministic and I/O-free, unit-testable in isolation.
// ---------------------------------------------------------------------------
describe('chunkAnswer (pure)', () => {
  const samples = [
    '',
    'x',
    'Hi.',
    'Found 3 symbols matching “recordEntry”: `recordEntry`, `post`, `LedgerService`.',
    'Related specs: REQ-LEDGER-001 — The ledger records entries.\n\nRelated domain facts: Ledger — an append-only record.',
    'A'.repeat(500),
    'word '.repeat(200),
    'No spaces or punctuation at all just one very long uninterrupted token stringstringstring',
    'Line one\nLine two\nLine three',
  ];

  it('reassembles to the original answer for every sample (A2/A3 invariant)', () => {
    for (const s of samples) {
      expect(chunkAnswer(s).join('')).toBe(s);
    }
  });

  it('returns no chunks for an empty answer', () => {
    expect(chunkAnswer('')).toEqual([]);
  });

  it('every chunk is non-empty', () => {
    for (const s of samples) {
      for (const c of chunkAnswer(s)) expect(c.length).toBeGreaterThan(0);
    }
  });

  it('splits a multi-sentence answer into more than one chunk (progressive reveal)', () => {
    const long = samples[3];
    expect(chunkAnswer(long).length).toBeGreaterThan(1);
  });

  it('is deterministic — identical input yields identical chunks', () => {
    for (const s of samples) {
      expect(chunkAnswer(s)).toEqual(chunkAnswer(s));
    }
  });
});

// ---------------------------------------------------------------------------
// Core + route integration (needs FTS5).
// ---------------------------------------------------------------------------
describe.skipIf(!fts5Available)('deterministic chat answer engine', () => {
  let dir: string;
  let cg: SpecShip;
  let app: FastifyInstance;

  beforeEach(async () => {
    dir = tempDir();
    cg = await SpecShip.init(dir);
    seedProject(dir);
    await cg.indexAll();
  });

  afterEach(async () => {
    await app?.close();
    cg?.close();
    clean(dir);
  });

  // -------------------------------------------------------------------------
  // A1: every returned source maps to a real indexed row.
  // -------------------------------------------------------------------------
  it('returns sources that all map to rows present in the index (A1)', () => {
    const res = answerFromKnowledgeBase(cg, 'how does recordEntry work');
    expect(res.found).toBe(true);
    expect(res.sources.length).toBeGreaterThan(0);
    for (const s of res.sources) {
      if (s.kind === 'symbol') {
        // The qualified name resolves to a real node in the graph.
        const nodes = cg.getNodesByName(s.label);
        expect(nodes.some((n) => n.qualifiedName === s.ref)).toBe(true);
      } else {
        // spec / domain: the id resolves to a real spec row.
        expect(cg.getSpecQueries().getSpecById(s.ref)).not.toBeNull();
      }
    }
    // Facts in the answer trace to the sources — the symbol name is rendered.
    expect(res.answer).toContain('recordEntry');
  });

  // -------------------------------------------------------------------------
  // A1: a spec/domain subject surfaces the spec and domain fact by real id.
  // -------------------------------------------------------------------------
  it('surfaces matching specs and domain facts by real id (A1)', () => {
    const res = answerFromKnowledgeBase(cg, 'what is a Ledger');
    expect(res.found).toBe(true);
    const refs = res.sources.map((s) => s.ref);
    expect(refs).toContain('DOMAIN-LEDGER');
    for (const s of res.sources) {
      if (s.kind !== 'symbol') expect(cg.getSpecQueries().getSpecById(s.ref)).not.toBeNull();
    }
  });

  // -------------------------------------------------------------------------
  // A3: determinism — same index + same question → byte-identical answer.
  // -------------------------------------------------------------------------
  it('produces byte-identical answers on repeat (A3)', () => {
    const q = 'how does recordEntry work';
    const first = answerFromKnowledgeBase(cg, q);
    const second = answerFromKnowledgeBase(cg, q);
    expect(second).toEqual(first);
    // Serialize to prove the whole body (answer + sources order) is stable.
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  // -------------------------------------------------------------------------
  // A4: an absent subject → honest not-found, no invented symbol/path/fact.
  // -------------------------------------------------------------------------
  it('returns an honest not-found for an absent subject (A4)', () => {
    const res = answerFromKnowledgeBase(cg, 'how does frobnicateWidget work');
    expect(res.found).toBe(false);
    expect(res.sources).toEqual([]);
    // The subject it echoes is the user's own word, not an invented symbol,
    // and no file path or made-up identifier leaks in.
    expect(res.answer).toContain('frobnicateWidget');
    expect(res.answer).not.toMatch(/\.ts:\d+/);
    expect(res.answer.toLowerCase()).toContain("couldn't find");
  });

  // -------------------------------------------------------------------------
  // A2 (behavioural): answering makes no network call and needs no model creds.
  // We can't assert on egress from a pure function directly, so guard the
  // process globals: temporarily null fetch and clear model env, and confirm
  // a full answer is still produced.
  // -------------------------------------------------------------------------
  it('answers without fetch and without model credentials (A2)', () => {
    const savedFetch = (globalThis as { fetch?: unknown }).fetch;
    (globalThis as { fetch?: unknown }).fetch = () => {
      throw new Error('network egress attempted in chat answer path');
    };
    const savedEnv = { ...process.env };
    for (const k of Object.keys(process.env)) {
      if (/API_KEY|OPENAI|ANTHROPIC|GEMINI/i.test(k)) delete process.env[k];
    }
    try {
      const res = answerFromKnowledgeBase(cg, 'how does recordEntry work');
      expect(res.found).toBe(true);
    } finally {
      (globalThis as { fetch?: unknown }).fetch = savedFetch;
      process.env = savedEnv;
    }
  });

  // -------------------------------------------------------------------------
  // REQ-DASH-CHAT-002 dispatch: each non-search intent hits the right query
  // family. classifyIntent → answerForIntent is the exact path the route runs.
  // -------------------------------------------------------------------------
  it('callers intent traverses the call graph (dispatch)', () => {
    const res = answerForIntent(cg, classifyIntent('who calls recordEntry'));
    expect(res.found).toBe(true);
    // LedgerService.post calls recordEntry — the caller is surfaced.
    expect(res.answer).toContain('post');
    // The subject node is the first traced source.
    expect(res.sources[0].kind).toBe('symbol');
    expect(res.sources[0].label).toBe('recordEntry');
  });

  it('callees intent traverses outgoing calls (dispatch)', () => {
    const res = answerForIntent(cg, classifyIntent('what does post call'));
    expect(res.found).toBe(true);
    // post → recordEntry.
    expect(res.answer).toContain('recordEntry');
  });

  it('impact intent reports the downstream blast radius (dispatch)', () => {
    const res = answerForIntent(cg, classifyIntent('what breaks if I change recordEntry'));
    expect(res.found).toBe(true);
    expect(res.answer.toLowerCase()).toContain('could affect');
  });

  it('spec intent resolves an exact id (dispatch)', () => {
    const res = answerForIntent(cg, classifyIntent('/ss-spec REQ-LEDGER-001'));
    expect(res.found).toBe(true);
    expect(res.answer).toContain('REQ-LEDGER-001');
    expect(res.sources.map((s) => s.ref)).toContain('REQ-LEDGER-001');
  });

  it('domain intent hits the domain-fact layer (dispatch)', () => {
    const res = answerForIntent(cg, classifyIntent('what is a Ledger'));
    expect(res.found).toBe(true);
    expect(res.sources.map((s) => s.ref)).toContain('DOMAIN-LEDGER');
    expect(res.sources.every((s) => s.kind === 'domain')).toBe(true);
  });

  it('drift intent reads the out-of-sync links (dispatch)', () => {
    const res = answerForIntent(cg, classifyIntent('/ss-check'));
    // Freshly indexed project has no drift → honest in-sync answer, no sources.
    expect(res.found).toBe(true);
    expect(res.answer.toLowerCase()).toContain('in sync');
    expect(res.sources).toEqual([]);
  });

  it('the route dispatches a callers question through the classifier (route)', async () => {
    app = await buildTestApp(cg);
    const res = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: { question: 'who calls recordEntry' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload) as { found: boolean; answer: string };
    expect(body.found).toBe(true);
    expect(body.answer).toContain('post');
  });

  // -------------------------------------------------------------------------
  // Route: 200 shape for an answerable question.
  // -------------------------------------------------------------------------
  it('POST /api/chat returns 200 with {found, answer, sources} (route)', async () => {
    app = await buildTestApp(cg);
    const res = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: { question: 'how does recordEntry work' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload) as { found: boolean; answer: string; sources: unknown[] };
    expect(body.found).toBe(true);
    expect(typeof body.answer).toBe('string');
    expect(Array.isArray(body.sources)).toBe(true);
    expect(body.sources.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // Route: 400 on an empty question.
  // -------------------------------------------------------------------------
  it('POST /api/chat returns 400 when the question is empty (route)', async () => {
    app = await buildTestApp(cg);
    const res = await app.inject({ method: 'POST', url: '/api/chat', payload: { question: '   ' } });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload) as { code: string };
    expect(body.code).toBe('bad_request');
  });
});

// ---------------------------------------------------------------------------
// Route: 409 when no project is selectable (no FTS5 needed).
// ---------------------------------------------------------------------------
describe('POST /api/chat no-project', () => {
  let app: FastifyInstance;
  afterEach(async () => { await app?.close(); });

  it('returns 409 no_project when no project is selectable (route)', async () => {
    app = await buildTestApp(null);
    const res = await app.inject({ method: 'POST', url: '/api/chat', payload: { question: 'anything' } });
    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.payload) as { code: string };
    expect(body.code).toBe('no_project');
  });
});
