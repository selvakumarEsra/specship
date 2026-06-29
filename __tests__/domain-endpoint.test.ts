/**
 * Tests for GET /api/domain (REQ-DOMAIN-007).
 *
 * Builds a real temp project, initializes SpecShip, writes domain spec files,
 * syncs so the domain facts are indexed, then hits the route via Fastify's
 * built-in `.inject()` (no network). Mirrors `spec-brief-endpoint.test.ts`.
 *
 *   A1     — facts grouped by metadata.type + numeric {documented, gaps}.
 *   A1     — empty domain layer → 200 with empty buckets and a valid rollup.
 *   409    — no project selectable → 409 / no_project.
 *   A2     — the route module bare-imports nothing from the package (source scan).
 *   A3     — /api/specs shape is unchanged in the same fixture.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import Fastify from 'fastify';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import SpecShip from '../src/index';
import { registerDomainRoutes } from '../packages/server/src/routes/domain';
import { registerSpecRoutes } from '../packages/server/src/routes/spec';

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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'domain-endpoint-'));
}
function clean(d: string): void {
  if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
}

/**
 * Minimal Fastify app: decorate `activeCg` to return the supplied SpecShip
 * instance, then register both routes under test. When `cg` is null the
 * decorator returns null so the 409 branch fires.
 */
async function buildTestApp(cg: SpecShip | null): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.decorate('activeCg', async function (_req: FastifyRequest): Promise<SpecShip | null> {
    return cg;
  });
  await registerDomainRoutes(app);
  await registerSpecRoutes(app);
  await app.ready();
  return app;
}

// ---------------------------------------------------------------------------
// A2: static source scan — no runtime import of the bare package.
// ---------------------------------------------------------------------------
describe('domain route source (REQ-DOMAIN-007.A2)', () => {
  it('contains no runtime import from @specship/specship', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'packages', 'server', 'src', 'routes', 'domain.ts'),
      'utf-8',
    );
    // A value import would be `import { x } from '@specship/specship'`.
    // A2 forbids that; a type-only import (erased at compile) would not, but the
    // route uses neither — so assert the package name never appears in an import.
    expect(source).not.toMatch(/from\s+['"]@specship\/specship['"]/);
  });
});

// ---------------------------------------------------------------------------
// Integration tests for GET /api/domain
// ---------------------------------------------------------------------------
describe.skipIf(!fts5Available)('GET /api/domain', () => {
  let dir: string;
  let cg: SpecShip;
  let app: FastifyInstance;

  beforeEach(async () => {
    dir = tempDir();
    cg = await SpecShip.init(dir);
  });

  afterEach(async () => {
    await app?.close();
    cg?.close();
    clean(dir);
  });

  // -------------------------------------------------------------------------
  // A1: domain facts of differing metadata.type are grouped into their buckets,
  // and coverage carries numeric documented + gaps.
  // -------------------------------------------------------------------------
  it('returns 200 with facts grouped by type and a numeric coverage rollup', async () => {
    const domainDir = path.join(dir, 'specs', 'domain');
    fs.mkdirSync(domainDir, { recursive: true });
    // A domain fact's type lives in `type:` frontmatter (→ spec.metadata.type).
    fs.writeFileSync(path.join(domainDir, 'glossary.md'), `---
id: GLOSSARY
kind: domain
type: term
title: Ledger
---
<!-- id: DOMAIN-LEDGER -->
# Ledger

A ledger is the append-only record of balance changes.
`, 'utf-8');
    fs.writeFileSync(path.join(domainDir, 'rules.md'), `---
id: RULES
kind: domain
type: rule
title: Settlement window
---
<!-- id: DOMAIN-SETTLE -->
# Settlement window

Settlement MUST complete within one business day.
`, 'utf-8');

    await cg.indexAll();
    app = await buildTestApp(cg);

    const res = await app.inject({ method: 'GET', url: '/api/domain' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload) as {
      factsByType: Record<string, Array<{ id: string; title: string; body: string }>>;
      coverage: { documented: number; gaps: number };
    };

    // Buckets exist and the two facts landed in `term` / `rule`.
    expect(body.factsByType).toHaveProperty('term');
    expect(body.factsByType).toHaveProperty('rule');
    expect(body.factsByType).toHaveProperty('decision');
    expect(body.factsByType).toHaveProperty('constraint');
    expect(body.factsByType).toHaveProperty('other');

    const allFacts = Object.values(body.factsByType).flat();
    expect(allFacts.length).toBeGreaterThanOrEqual(2);
    expect(body.factsByType.term.some((f) => f.id === 'GLOSSARY')).toBe(true);
    expect(body.factsByType.rule.some((f) => f.id === 'RULES')).toBe(true);
    // Each mapped fact carries the {id, title, body} shape.
    for (const f of allFacts) {
      expect(typeof f.id).toBe('string');
      expect(typeof f.title).toBe('string');
      expect(typeof f.body).toBe('string');
    }

    expect(typeof body.coverage.documented).toBe('number');
    expect(typeof body.coverage.gaps).toBe('number');
  });

  // -------------------------------------------------------------------------
  // A1 (empty): no domain facts → 200, empty buckets, valid coverage rollup.
  // -------------------------------------------------------------------------
  it('returns 200 with empty buckets when there are no domain facts', async () => {
    await cg.indexAll();
    app = await buildTestApp(cg);

    const res = await app.inject({ method: 'GET', url: '/api/domain' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload) as {
      factsByType: Record<string, unknown[]>;
      coverage: { documented: number; gaps: number };
    };
    expect(Object.values(body.factsByType).every((arr) => Array.isArray(arr) && arr.length === 0)).toBe(true);
    expect(typeof body.coverage.documented).toBe('number');
    expect(typeof body.coverage.gaps).toBe('number');
  });

  // -------------------------------------------------------------------------
  // 409: no project selectable.
  // -------------------------------------------------------------------------
  it('returns 409 no_project when no project is selectable', async () => {
    app = await buildTestApp(null);
    const res = await app.inject({ method: 'GET', url: '/api/domain' });
    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.payload) as { code: string };
    expect(body.code).toBe('no_project');
  });

  // -------------------------------------------------------------------------
  // A3: /api/specs shape is unchanged in the same fixture.
  // -------------------------------------------------------------------------
  it('leaves GET /api/specs shape unchanged (no regression)', async () => {
    const domainDir = path.join(dir, 'specs', 'domain');
    fs.mkdirSync(domainDir, { recursive: true });
    fs.writeFileSync(path.join(domainDir, 'glossary.md'), `---
id: GLOSSARY
kind: domain
type: term
title: Ledger
---
<!-- id: DOMAIN-LEDGER -->
# Ledger

A ledger is the append-only record of balance changes.
`, 'utf-8');

    await cg.indexAll();
    app = await buildTestApp(cg);

    const res = await app.inject({ method: 'GET', url: '/api/specs' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload) as { specs: unknown[] };
    expect(Array.isArray(body.specs)).toBe(true);
  });
});
