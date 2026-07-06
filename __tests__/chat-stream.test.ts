/**
 * Tests for the faux-streaming dashboard chat (REQ-DASH-CHAT-003).
 *
 * Builds a real temp project, initializes SpecShip, indexes source + spec +
 * domain, then drives `GET /api/chat/stream` over a real loopback HTTP server
 * (native `fetch` reads the SSE body) so the paced event sequence and a genuine
 * mid-stream client disconnect are exercised end-to-end.
 *
 *   A1  — the stream emits, in order: thinking → tool → result_summary →
 *         chunk(s) → done.
 *   A2  — the concatenation of the chunk events equals the fully-composed answer.
 *   A3  — the answer is fixed before streaming: the streamed text equals what
 *         `answerForIntent` composes for the same question.
 *   A4  — a client disconnect mid-stream ends the stream without throwing; the
 *         server keeps serving.
 *   guards — 409 no-project, 400 empty question.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import Fastify from 'fastify';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import SpecShip from '../src/index';
import { registerChatRoutes } from '../server/src/routes/chat';
import { answerForIntent } from '../server/src/routes/chat-answer';
import { classifyIntent } from '../server/src/chat/classify';

// ---------------------------------------------------------------------------
// FTS5 guard — the streamed answer is search-driven, so skip the integration
// block when FTS5 is unavailable (same probe the rest of the suite uses).
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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'chat-stream-'));
}
function clean(d: string): void {
  if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
}

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

/** One parsed SSE frame. */
interface SseEvent { event: string; data: unknown; }

/** Parse an SSE payload string into ordered {event, data} frames. */
function parseSse(raw: string): SseEvent[] {
  const events: SseEvent[] = [];
  for (const block of raw.split('\n\n')) {
    const lines = block.split('\n');
    let event = 'message';
    let dataStr = '';
    for (const line of lines) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) dataStr += line.slice(5).trim();
    }
    if (dataStr.length === 0) continue;
    let data: unknown = dataStr;
    try { data = JSON.parse(dataStr); } catch { /* keep raw */ }
    events.push({ event, data });
  }
  return events;
}

// ---------------------------------------------------------------------------
// Route guards — no FTS5 needed (both short-circuit before any query).
// ---------------------------------------------------------------------------
describe('GET /api/chat/stream guards', () => {
  let app: FastifyInstance;
  afterEach(async () => { await app?.close(); });

  it('returns 409 no_project when no project is selectable', async () => {
    app = await buildTestApp(null);
    const res = await app.inject({ method: 'GET', url: '/api/chat/stream?question=anything' });
    expect(res.statusCode).toBe(409);
    expect((JSON.parse(res.payload) as { code: string }).code).toBe('no_project');
  });

  it('returns 400 when the question is empty', async () => {
    const dir = tempDir();
    try {
      const cg = await SpecShip.init(dir);
      app = await buildTestApp(cg);
      const res = await app.inject({ method: 'GET', url: '/api/chat/stream?question=%20%20' });
      expect(res.statusCode).toBe(400);
      expect((JSON.parse(res.payload) as { code: string }).code).toBe('bad_request');
      cg.close();
    } finally {
      clean(dir);
    }
  });
});

// ---------------------------------------------------------------------------
// Streaming integration (needs FTS5) — real loopback server + fetch.
// ---------------------------------------------------------------------------
describe.skipIf(!fts5Available)('GET /api/chat/stream faux-streaming', () => {
  let dir: string;
  let cg: SpecShip;
  let app: FastifyInstance;
  let baseUrl: string;

  beforeEach(async () => {
    dir = tempDir();
    cg = await SpecShip.init(dir);
    seedProject(dir);
    await cg.indexAll();
    app = await buildTestApp(cg);
    const addr = await app.listen({ port: 0, host: '127.0.0.1' });
    baseUrl = addr; // fastify returns e.g. http://127.0.0.1:PORT
  });

  afterEach(async () => {
    await app?.close();
    cg?.close();
    clean(dir);
  });

  it('emits thinking → tool → result_summary → chunk(s) → done in order (A1)', async () => {
    const res = await fetch(`${baseUrl}/api/chat/stream?question=${encodeURIComponent('how does recordEntry work')}`);
    expect(res.ok).toBe(true);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const events = parseSse(await res.text());

    const order = events.map((e) => e.event);
    expect(order[0]).toBe('thinking');
    expect(order[1]).toBe('tool');
    expect(order[2]).toBe('result_summary');
    expect(order[order.length - 1]).toBe('done');
    // At least one chunk between result_summary and done.
    const middle = order.slice(3, -1);
    expect(middle.length).toBeGreaterThan(0);
    expect(middle.every((e) => e === 'chunk')).toBe(true);
  });

  it('reflects the request Origin as Access-Control-Allow-Origin so cross-origin EventSource works', async () => {
    // Regression: SSE handlers write reply.raw directly, bypassing @fastify/cors,
    // so a cross-origin dashboard (127.0.0.1 vs localhost) got CORS-blocked.
    const origin = 'http://127.0.0.1:4242';
    const res = await fetch(`${baseUrl}/api/chat/stream?question=${encodeURIComponent('how does recordEntry work')}`, {
      headers: { Origin: origin },
    });
    expect(res.headers.get('access-control-allow-origin')).toBe(origin);
    await res.text(); // drain to close the stream
  });

  it('the tool event names the real capability and query input (A1 / CHAT-004.A2)', async () => {
    const res = await fetch(`${baseUrl}/api/chat/stream?question=${encodeURIComponent('who calls recordEntry')}`);
    const events = parseSse(await res.text());
    const tool = events.find((e) => e.event === 'tool')!.data as { name: string; input: string };
    expect(tool.name).toBe('specship_callers');
    expect(tool.input).toBe('recordEntry');
    // result_summary carries a truthful source count, not a constant string.
    const summary = events.find((e) => e.event === 'result_summary')!.data as { found: boolean; sourceCount: number };
    expect(summary.found).toBe(true);
    expect(summary.sourceCount).toBeGreaterThan(0);
  });

  it('the concatenated chunks equal the fully-composed answer (A2/A3)', async () => {
    const question = 'how does recordEntry work';
    const expected = answerForIntent(cg, classifyIntent(question)).answer;

    const res = await fetch(`${baseUrl}/api/chat/stream?question=${encodeURIComponent(question)}`);
    const events = parseSse(await res.text());
    const streamed = events
      .filter((e) => e.event === 'chunk')
      .map((e) => (e.data as { text: string }).text)
      .join('');
    expect(streamed).toBe(expected);

    // done carries the same sources as the one-shot answer (A3).
    const done = events.find((e) => e.event === 'done')!.data as { found: boolean; sources: unknown[] };
    expect(done.found).toBe(true);
    expect(Array.isArray(done.sources)).toBe(true);
  });

  it('ends cleanly on a mid-stream client disconnect and keeps serving (A4)', async () => {
    const rejections: unknown[] = [];
    const onRejection = (e: unknown): void => { rejections.push(e); };
    process.on('unhandledRejection', onRejection);
    try {
      const ac = new AbortController();
      const res = await fetch(
        `${baseUrl}/api/chat/stream?question=${encodeURIComponent('how does recordEntry work')}`,
        { signal: ac.signal },
      );
      // Read the first bytes, then abort mid-stream.
      const reader = res.body!.getReader();
      await reader.read();
      ac.abort();
      await reader.cancel().catch(() => { /* aborted */ });

      // Give the server a beat to observe the socket close and clear its timer.
      await new Promise((r) => setTimeout(r, 60));

      // The server survives the disconnect and still answers a fresh request.
      const res2 = await fetch(`${baseUrl}/api/chat/stream?question=${encodeURIComponent('what is a Ledger')}`);
      const events = parseSse(await res2.text());
      expect(events[events.length - 1].event).toBe('done');

      expect(rejections).toEqual([]);
    } finally {
      process.off('unhandledRejection', onRejection);
    }
  });
});
