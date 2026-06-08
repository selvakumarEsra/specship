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

import { describe, it, expect } from 'vitest';
import { MarkdownSpecExtractor } from '../src/extraction/specs/markdown-spec-extractor';

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
});
