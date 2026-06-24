/**
 * Tests for:
 *   1. `parseBriefField(source)` — pure exported helper; extracts the `brief:`
 *      value from YAML frontmatter.
 *   2. `GET /api/spec/:id/brief` — Fastify route; returns {path, markdown} for
 *      a spec whose source file carries a `brief:` frontmatter field pointing
 *      to a file that exists on disk.
 *
 * Integration tests build a real temp project, initialize SpecShip, insert a
 * spec row with a known sourcePath, and hit the route via Fastify's built-in
 * `.inject()` (no network required).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import Fastify from 'fastify';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import SpecShip from '../src/index';
import { parseBriefField, registerSpecRoutes } from '../packages/server/src/routes/spec';

// ---------------------------------------------------------------------------
// FTS5 guard — identical pattern used across the spec test suite.
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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'spec-brief-'));
}
function clean(d: string): void {
  if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// 1. Unit tests for parseBriefField (pure, no SpecShip needed)
// ---------------------------------------------------------------------------

describe('parseBriefField', () => {
  it('returns the brief value when present in frontmatter', () => {
    const source = `---
id: DOC
title: My spec
brief: foo/brief.md
---
# Content
`;
    expect(parseBriefField(source)).toBe('foo/brief.md');
  });

  it('strips surrounding double-quotes from the value', () => {
    const source = `---
brief: "bar/brief.md"
---
`;
    expect(parseBriefField(source)).toBe('bar/brief.md');
  });

  it('strips surrounding single-quotes from the value', () => {
    const source = `---
brief: 'baz/brief.md'
---
`;
    expect(parseBriefField(source)).toBe('baz/brief.md');
  });

  it('strips a trailing inline # comment from an unquoted value', () => {
    const source = `---
brief: foo/brief.md # note
---
`;
    expect(parseBriefField(source)).toBe('foo/brief.md');
  });

  it('does not mangle a # that is part of the path (no preceding whitespace)', () => {
    const source = `---
brief: foo/brief.md#frag
---
`;
    expect(parseBriefField(source)).toBe('foo/brief.md#frag');
  });

  it('returns null when there is no brief key', () => {
    const source = `---
id: DOC
title: No brief here
---
# Content
`;
    expect(parseBriefField(source)).toBeNull();
  });

  it('returns null when there is no frontmatter at all', () => {
    expect(parseBriefField('# Just a heading\n\nSome body.')).toBeNull();
  });

  it('returns null when the brief value is empty', () => {
    const source = `---
brief:
---
`;
    expect(parseBriefField(source)).toBeNull();
  });

  it('returns null for unterminated frontmatter (no closing ---)', () => {
    const source = `---
brief: foo/brief.md
# no closing fence
`;
    expect(parseBriefField(source)).toBeNull();
  });

  it('ignores brief keys that appear after the frontmatter block', () => {
    const source = `---
id: DOC
---
brief: should-be-ignored.md
`;
    expect(parseBriefField(source)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. Integration tests for GET /api/spec/:id/brief
// ---------------------------------------------------------------------------

/**
 * Build a minimal Fastify app that mimics what createServer() does for the
 * routes under test, but without a listening port, watcher, or CORS setup.
 * Decorates `activeCg` with a closure that returns the supplied SpecShip
 * instance so route handlers work identically to production.
 */
async function buildTestApp(cg: SpecShip): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  // Minimal `activeCg` decorator: always returns the supplied instance.
  app.decorate('activeCg', async function (_req: FastifyRequest): Promise<SpecShip> {
    return cg;
  });

  await registerSpecRoutes(app);
  await app.ready();
  return app;
}

describe.skipIf(!fts5Available)('GET /api/spec/:id/brief', () => {
  let dir: string;
  let cg: SpecShip;
  let app: FastifyInstance;

  beforeEach(async () => {
    dir = tempDir();
    cg = await SpecShip.init(dir);
    app = await buildTestApp(cg);
  });

  afterEach(async () => {
    await app.close();
    cg?.close();
    clean(dir);
  });

  // -------------------------------------------------------------------------
  // Happy path: spec file has `brief:` and the brief file exists on disk.
  // -------------------------------------------------------------------------
  it('returns 200 {path, markdown} when brief file exists', async () => {
    // Write the spec source file (project-relative path: specs/auth.md).
    const specDir = path.join(dir, 'specs');
    fs.mkdirSync(specDir, { recursive: true });
    const specContent = `---
id: AUTH-DOC
title: Auth spec
brief: AUTH-DOC/brief.md
---
<!-- id: REQ-AUTH-001 -->
# Login must rate-limit

Body text.
`;
    fs.writeFileSync(path.join(specDir, 'auth.md'), specContent, 'utf-8');

    // Write the brief file (relative to the spec file: specs/AUTH-DOC/brief.md).
    const briefDir = path.join(specDir, 'AUTH-DOC');
    fs.mkdirSync(briefDir, { recursive: true });
    const briefContent = '# Auth brainstorm brief\n\nThis is the brief.\n';
    fs.writeFileSync(path.join(briefDir, 'brief.md'), briefContent, 'utf-8');

    // Insert the spec row so getSpecById can find it. Use the actual
    // project-relative sourcePath that the route reads.
    const now = Date.now();
    cg.getSpecQueries().insertSpec({
      id: 'AUTH-DOC',
      kind: 'document',
      title: 'Auth spec',
      body: 'Body text.',
      format: 'markdown',
      sourcePath: 'specs/auth.md',
      startLine: 1,
      endLine: 9,
      contentHash: 'hash-auth',
      createdAt: now,
      updatedAt: now,
    });

    const res = await app.inject({ method: 'GET', url: '/api/spec/AUTH-DOC/brief' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload) as { path: string; markdown: string };
    expect(body.path).toBe('AUTH-DOC/brief.md');
    expect(body.markdown).toBe(briefContent);
  });

  // -------------------------------------------------------------------------
  // 404: spec exists but its source file has no `brief:` frontmatter key.
  // -------------------------------------------------------------------------
  it('returns 404 when spec has no brief: frontmatter', async () => {
    const specDir = path.join(dir, 'specs');
    fs.mkdirSync(specDir, { recursive: true });
    const specContent = `---
id: NO-BRIEF
title: No brief spec
---
<!-- id: REQ-NO-001 -->
# A requirement

Body.
`;
    fs.writeFileSync(path.join(specDir, 'no-brief.md'), specContent, 'utf-8');

    const now = Date.now();
    cg.getSpecQueries().insertSpec({
      id: 'NO-BRIEF',
      kind: 'document',
      title: 'No brief spec',
      body: 'Body.',
      format: 'markdown',
      sourcePath: 'specs/no-brief.md',
      startLine: 1,
      endLine: 8,
      contentHash: 'hash-nobr',
      createdAt: now,
      updatedAt: now,
    });

    const res = await app.inject({ method: 'GET', url: '/api/spec/NO-BRIEF/brief' });
    expect(res.statusCode).toBe(404);
  });

  // -------------------------------------------------------------------------
  // 404: spec ID not in DB.
  // -------------------------------------------------------------------------
  it('returns 404 when spec id does not exist', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/spec/NONEXISTENT/brief' });
    expect(res.statusCode).toBe(404);
  });

  // -------------------------------------------------------------------------
  // Traversal guard: brief: value containing ../ must NOT escape project root.
  // -------------------------------------------------------------------------
  it('returns 404 for a traversal brief path and never leaks the outside file', async () => {
    // Plant a real sentinel file OUTSIDE the project root. The spec lives at
    // <root>/specs/traversal.md, so `../../secret.txt` from that file's dir
    // resolves to <parent-of-root>/secret.txt — genuinely outside the root.
    const SENTINEL = 'TOP-SECRET-SENTINEL-9f3a2b';
    const outsideFile = path.join(path.dirname(dir), 'secret.txt');
    fs.writeFileSync(outsideFile, SENTINEL, 'utf-8');

    try {
      const specDir = path.join(dir, 'specs');
      fs.mkdirSync(specDir, { recursive: true });
      const specContent = `---
id: TRAV-DOC
title: Traversal spec
brief: ../../secret.txt
---
<!-- id: REQ-TRAV-001 -->
# Traversal requirement

Body.
`;
      fs.writeFileSync(path.join(specDir, 'traversal.md'), specContent, 'utf-8');

      const now = Date.now();
      cg.getSpecQueries().insertSpec({
        id: 'TRAV-DOC',
        kind: 'document',
        title: 'Traversal spec',
        body: 'Body.',
        format: 'markdown',
        sourcePath: 'specs/traversal.md',
        startLine: 1,
        endLine: 9,
        contentHash: 'hash-trav',
        createdAt: now,
        updatedAt: now,
      });

      const res = await app.inject({ method: 'GET', url: '/api/spec/TRAV-DOC/brief' });
      // Must not return 200 — either 404 (traversal blocked) or 400.
      expect(res.statusCode).not.toBe(200);
      expect([400, 404]).toContain(res.statusCode);
      // Prove the guard FIRED rather than relying on file-absence: the
      // outside file exists and is readable, yet its content must never
      // appear in the response.
      expect(res.payload).not.toContain(SENTINEL);
    } finally {
      fs.rmSync(outsideFile, { force: true });
    }
  });
});
