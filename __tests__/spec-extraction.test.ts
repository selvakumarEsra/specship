/**
 * Spec extraction tests — covers MarkdownSpecExtractor in isolation.
 *
 * Asserts:
 *   - Embedded IDs are picked up; missing IDs produce error-severity
 *     ExtractionError entries.
 *   - Heading hierarchy maps to parent_id correctly (H1 = requirement,
 *     H3 = acceptance).
 *   - `implementations:` bullets become SpecLinkCandidate rows.
 *   - Frontmatter populates owner / priority / metadata.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { MarkdownSpecExtractor } from '../src/extraction/specs/markdown-spec-extractor';
import SpecShip from '../src';
import type { QueryBuilder } from '../src/db/queries';

describe('MarkdownSpecExtractor', () => {
  it('extracts document + requirement with embedded IDs', () => {
    const source = `---
id: AUTH-DOC
title: Authentication
owner: security
priority: P0
---
<!-- id: REQ-AUTH-001 -->
# Login must rate-limit

The login endpoint rejects more than 5 failed attempts per IP per minute.
`;
    const result = new MarkdownSpecExtractor('specs/auth.md', source).extract();
    expect(result.errors).toEqual([]);
    expect(result.specs).toHaveLength(2);

    const doc = result.specs.find((s) => s.id === 'AUTH-DOC');
    expect(doc).toBeDefined();
    expect(doc!.kind).toBe('document');
    expect(doc!.owner).toBe('security');
    expect(doc!.priority).toBe('P0');

    const req = result.specs.find((s) => s.id === 'REQ-AUTH-001');
    expect(req).toBeDefined();
    expect(req!.kind).toBe('requirement');
    expect(req!.parentId).toBe('AUTH-DOC');
    expect(req!.title).toBe('Login must rate-limit');
  });

  it('errors on heading without embedded ID', () => {
    const source = `---
id: DOC1
---
<!-- id: REQ-1 -->
# Has ID

Body.

# Missing ID

Body.
`;
    const result = new MarkdownSpecExtractor('specs/x.md', source).extract();
    const fatal = result.errors.filter((e) => e.severity === 'error');
    expect(fatal).toHaveLength(1);
    expect(fatal[0]!.message).toContain('Missing ID');
    expect(fatal[0]!.code).toBe('spec_missing_id');
  });

  it('warns on stranded ID comment', () => {
    const source = `---
id: DOC2
---
<!-- id: STRAY -->
<!-- id: REAL -->
# Title

Body.
`;
    const result = new MarkdownSpecExtractor('specs/x.md', source).extract();
    const stranded = result.errors.find((e) => e.code === 'spec_stranded_id');
    expect(stranded).toBeDefined();
    expect(stranded!.severity).toBe('warning');
  });

  it('extracts implementations: as link candidates', () => {
    const source = `---
id: DOC
---
<!-- id: REQ-1 -->
# A requirement

implementations:
  - src/auth/login.ts:authenticate
  - src/auth/rate-limit.ts:enforce
`;
    const result = new MarkdownSpecExtractor('specs/x.md', source).extract();
    expect(result.linkCandidates).toHaveLength(2);
    expect(result.linkCandidates[0]).toMatchObject({
      specId: 'REQ-1',
      targetFilePath: 'src/auth/login.ts',
      targetQualifiedName: 'authenticate',
      kind: 'implements',
    });
    expect(result.linkCandidates[1]!.targetFilePath).toBe('src/auth/rate-limit.ts');
  });

  it('builds 3-level hierarchy: document → requirement → acceptance', () => {
    const source = `---
id: DOC
---
<!-- id: REQ -->
# Requirement
<!-- id: ACC1 -->
### Acceptance 1
Body.
<!-- id: ACC2 -->
### Acceptance 2
Body.
`;
    const result = new MarkdownSpecExtractor('specs/x.md', source).extract();
    expect(result.errors).toEqual([]);
    expect(result.specs.map((s) => s.id).sort()).toEqual(['ACC1', 'ACC2', 'DOC', 'REQ']);
    const acc1 = result.specs.find((s) => s.id === 'ACC1')!;
    expect(acc1.kind).toBe('acceptance');
    expect(acc1.parentId).toBe('REQ');
  });

  it('content_hash differs when body changes', () => {
    const make = (body: string) => `---
id: D
---
<!-- id: R -->
# Title

${body}
`;
    const a = new MarkdownSpecExtractor('x.md', make('one')).extract();
    const b = new MarkdownSpecExtractor('x.md', make('two')).extract();
    const ra = a.specs.find((s) => s.id === 'R')!;
    const rb = b.specs.find((s) => s.id === 'R')!;
    expect(ra.contentHash).not.toBe(rb.contentHash);
  });

  it('treats a same-id frontmatter + H1 as the document, not a self-parented requirement (REQ-PROJECTION-001)', () => {
    const source = `---
id: FUNNEL-DOC
title: Funnel
---
<!-- id: FUNNEL-DOC -->
# Funnel

Intro prose for the document.

<!-- id: REQ-1 -->
## A requirement

Body.
`;
    const result = new MarkdownSpecExtractor('specs/funnel.md', source).extract();
    expect(result.errors).toEqual([]);

    // Exactly one spec carries the document id, and it is the document — not a
    // self-parented requirement clobbering it.
    const withDocId = result.specs.filter((s) => s.id === 'FUNNEL-DOC');
    expect(withDocId).toHaveLength(1);
    const doc = withDocId[0]!;
    expect(doc.kind).toBe('document');
    expect(doc.parentId).toBeUndefined();

    // Body is the H1 intro prose — non-empty, and does not swallow the requirement.
    expect(doc.body).toContain('Intro prose for the document.');
    expect(doc.body).not.toContain('A requirement');

    // The requirement parents to the document.
    const req = result.specs.find((s) => s.id === 'REQ-1')!;
    expect(req.kind).toBe('requirement');
    expect(req.parentId).toBe('FUNNEL-DOC');
  });

  it('promotes a lone H1 with an id to the document when frontmatter has no id (REQ-PROJECTION-002)', () => {
    const source = `<!-- id: SOLO-DOC -->
# Solo document

Intro.

<!-- id: REQ-X -->
## A requirement

Body.
`;
    const result = new MarkdownSpecExtractor('specs/solo.md', source).extract();
    expect(result.errors).toEqual([]);

    const doc = result.specs.find((s) => s.id === 'SOLO-DOC')!;
    expect(doc.kind).toBe('document');
    expect(doc.parentId).toBeUndefined();

    const req = result.specs.find((s) => s.id === 'REQ-X')!;
    expect(req.kind).toBe('requirement');
    expect(req.parentId).toBe('SOLO-DOC');
  });

  it('emits no document when there is neither a frontmatter id nor an H1 id (REQ-PROJECTION-002)', () => {
    const source = `<!-- id: REQ-ONLY -->
## A requirement

Body.
`;
    const result = new MarkdownSpecExtractor('specs/reqonly.md', source).extract();
    expect(result.specs.filter((s) => s.kind === 'document')).toHaveLength(0);
    const req = result.specs.find((s) => s.id === 'REQ-ONLY')!;
    expect(req.parentId).toBeUndefined();
  });

  it('indexes a brief.md as a single brief-kind spec (REQ-FUNNEL-001)', () => {
    const source = `---
slug: foo-feature
spec: REQ-FOO-001
created: 2026-06-25
---
# Brainstorm: Foo feature

## Problem
The widget frobnicates incorrectly.
`;
    const result = new MarkdownSpecExtractor('specs/foo-feature/brief.md', source).extract();
    expect(result.errors.filter((e) => e.severity === 'error')).toEqual([]);
    expect(result.specs).toHaveLength(1);

    const brief = result.specs[0]!;
    expect(brief.id).toBe('brief:foo-feature');
    expect(brief.kind).toBe('brief');
    expect(brief.title).toBe('Brainstorm: Foo feature');
    expect(brief.parentId).toBeUndefined();
    // Full prose is in the body (so specs_fts indexes it — A2).
    expect(brief.body).toContain('frobnicates');
    // The spec pointer is carried in metadata for REQ-FUNNEL-002 to reconcile.
    expect((brief.metadata as Record<string, unknown>).spec).toBe('REQ-FOO-001');
  });

  it('skips a brief.md with no slug without failing the index (REQ-FUNNEL-001.A4)', () => {
    const source = `---
created: 2026-06-25
---
# Brainstorm: slugless

## Problem
x
`;
    const result = new MarkdownSpecExtractor('specs/bad/brief.md', source).extract();
    expect(result.specs).toHaveLength(0);
    expect(result.errors.filter((e) => e.severity === 'error')).toEqual([]);
  });
});

describe('MarkdownSpecExtractor — domain spec kind (REQ-DOMAIN-001)', () => {
  it('parses a specs/domain/ file with frontmatter id + type into a domain spec (A1)', () => {
    const source = `---
id: DOM-PAY-001
title: Settlement currency
type: rule
---
# Settlement currency

All payments settle in the merchant's account currency, never the buyer's.
`;
    const result = new MarkdownSpecExtractor('specs/domain/payments.md', source).extract();

    // No requirement-walker errors — the frontmatter-only file MUST NOT trip
    // spec_missing_id / spec_bad_frontmatter.
    expect(result.errors.find((e) => e.code === 'spec_missing_id')).toBeUndefined();
    expect(result.errors.find((e) => e.code === 'spec_bad_frontmatter')).toBeUndefined();
    expect(result.errors.filter((e) => e.severity === 'error')).toEqual([]);

    expect(result.specs).toHaveLength(1);
    const fact = result.specs[0]!;
    expect(fact.id).toBe('DOM-PAY-001');
    expect(fact.kind).toBe('domain');
    expect(fact.title).toBe('Settlement currency');
    expect(fact.parentId).toBeUndefined();
    expect(fact.body).toContain("merchant's account currency");
    expect((fact.metadata as Record<string, unknown>).type).toBe('rule');
  });

  it('skips a domain file with no frontmatter id without failing the index', () => {
    const source = `---
type: rule
---
# Untitled fact

Body.
`;
    const result = new MarkdownSpecExtractor('specs/domain/orphan.md', source).extract();
    expect(result.specs).toHaveLength(0);
    expect(result.errors.filter((e) => e.severity === 'error')).toEqual([]);
  });

  it('still indexes a domain fact with an unknown type, emitting a warning (A3)', () => {
    const source = `---
id: DOM-PAY-002
type: bogus
---
# A questionable fact

Body.
`;
    const result = new MarkdownSpecExtractor('specs/domain/payments.md', source).extract();

    // The fact is NEVER dropped.
    expect(result.specs).toHaveLength(1);
    expect(result.specs[0]!.kind).toBe('domain');
    expect((result.specs[0]!.metadata as Record<string, unknown>).type).toBe('bogus');

    const warn = result.errors.find((e) => e.code === 'spec_unknown_domain_type');
    expect(warn).toBeDefined();
    expect(warn!.severity).toBe('warning');
    expect(warn!.message).toContain('bogus');
  });

  it('produces an identical content_hash across two extractions of the same source (A4)', () => {
    const source = `---
id: DOM-PAY-003
type: decision
---
# Stable fact

Body that does not change.
`;
    const a = new MarkdownSpecExtractor('specs/domain/payments.md', source).extract();
    const b = new MarkdownSpecExtractor('specs/domain/payments.md', source).extract();
    expect(a.specs[0]!.contentHash).toBe(b.specs[0]!.contentHash);
  });
});

/** Probe whether the current process has FTS5 (mirrors spec-link-resolver.test.ts). */
const fts5Available = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require('better-sqlite3');
    const db = new Database(':memory:');
    try {
      db.exec('CREATE VIRTUAL TABLE _probe USING fts5(x)');
      db.close();
      return true;
    } catch {
      db.close();
    }
  } catch {
    /* fall through */
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(':memory:');
    try {
      db.exec('CREATE VIRTUAL TABLE _probe USING fts5(x)');
      db.close();
      return true;
    } catch {
      db.close();
    }
  } catch {
    /* node:sqlite unavailable */
  }
  return false;
})();

describe.skipIf(!fts5Available)('domain spec DB projection (REQ-DOMAIN-001.A2)', () => {
  let dir: string;
  let cg: SpecShip;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-domain-'));
    cg = await SpecShip.init(dir);
  });

  afterEach(async () => {
    cg?.close();
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('projects a domain spec as a spec: node (A2)', () => {
    const sq = cg.getSpecQueries();
    const now = Date.now();
    sq.insertSpec({
      id: 'DOM-PAY-001',
      kind: 'domain',
      title: 'Settlement currency',
      body: "All payments settle in the merchant's account currency.",
      format: 'markdown',
      sourcePath: 'specs/domain/payments.md',
      contentHash: 'hash-domain',
      metadata: { type: 'rule' },
      createdAt: now,
      updatedAt: now,
    });

    const queries = (cg as unknown as { queries: QueryBuilder }).queries;
    const node = queries.getNodeById('spec:DOM-PAY-001');
    expect(node).not.toBeNull();
    expect(node!.kind).toBe('spec');
    expect(node!.qualifiedName).toBe('DOM-PAY-001');

    // Returned by search (FTS over the projected node).
    const hits = cg.searchNodes('Settlement');
    expect(hits.some((r) => r.node.id === 'spec:DOM-PAY-001')).toBe(true);
  });
});
