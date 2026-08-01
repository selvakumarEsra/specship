import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  appendAcceptanceCriterion,
  applyContentAmendment,
  amendSpecFile,
} from '../../src/jira/spec-amend';

const SAMPLE = `---
jira_issue: PROJ-1
jira_fingerprint: abc123
---

<!-- id: REQ-DOC-001 -->
# The document

Intro prose.

<!-- id: REQ-AUTH-001 -->
## Failed login attempts must be rate-limited

The endpoint rejects more than 5 failures per minute.

implementations:
  - src/auth/login.ts:authenticate

verifies:
  - __tests__/auth.test.ts

## Acceptance
<!-- id: REQ-AUTH-001.A1 -->
- A 6th failure within 60s returns 429.

<!-- id: REQ-OTHER-001 -->
## Some other requirement

Different body.
`;

describe('appendAcceptanceCriterion — REQ-JIRATEAM-005.A4', () => {
  it('inserts under ## Acceptance without disturbing frontmatter or other reqs', () => {
    const res = appendAcceptanceCriterion(
      SAMPLE,
      'REQ-AUTH-001',
      'REQ-AUTH-001.A2',
      'The IP is banned for 24h after 100 failures.',
    );
    expect(res.changed).toBe(true);
    // Frontmatter intact
    expect(res.source).toMatch(/^---\njira_issue: PROJ-1/);
    // New criterion appears with its marker
    expect(res.source).toContain('<!-- id: REQ-AUTH-001.A2 -->');
    expect(res.source).toContain('- The IP is banned for 24h after 100 failures.');
    // Prior criterion is still there
    expect(res.source).toContain('<!-- id: REQ-AUTH-001.A1 -->');
    // Sibling requirement untouched
    expect(res.source).toContain('<!-- id: REQ-OTHER-001 -->');
    expect(res.source).toContain('## Some other requirement');
    // implementations/verifies blocks preserved
    expect(res.source).toContain('implementations:');
    expect(res.source).toContain('verifies:');
  });

  it('is idempotent: re-appending an existing id leaves the source unchanged', () => {
    const res = appendAcceptanceCriterion(
      SAMPLE,
      'REQ-AUTH-001',
      'REQ-AUTH-001.A1',
      'Anything',
    );
    expect(res.changed).toBe(false);
    expect(res.reason).toBe('already-present');
  });

  it('creates a fresh ## Acceptance section when none exists', () => {
    const src = `<!-- id: REQ-X-001 -->
## Bare requirement

Body only, no acceptance yet.
`;
    const res = appendAcceptanceCriterion(src, 'REQ-X-001', 'REQ-X-001.A1', 'First criterion.');
    expect(res.changed).toBe(true);
    expect(res.source).toContain('## Acceptance');
    expect(res.source).toContain('<!-- id: REQ-X-001.A1 -->');
  });
});

describe('applyContentAmendment — REQ-JIRATEAM-005.A4', () => {
  it('rewrites the H2 and prose without clobbering Acceptance / implementations / verifies', () => {
    const res = applyContentAmendment(
      SAMPLE,
      'REQ-AUTH-001',
      'Rate limit login attempts strictly',
      'The endpoint hard-bans an IP after 5 failures within 60 seconds.',
    );
    expect(res.changed).toBe(true);
    expect(res.source).toContain('## Rate limit login attempts strictly');
    expect(res.source).toContain('hard-bans an IP');
    expect(res.source).toContain('implementations:');
    expect(res.source).toContain('verifies:');
    expect(res.source).toContain('## Acceptance');
    expect(res.source).toContain('<!-- id: REQ-AUTH-001.A1 -->');
    // Frontmatter still intact
    expect(res.source).toMatch(/^---\njira_issue: PROJ-1/);
    // Sibling requirement untouched
    expect(res.source).toContain('## Some other requirement');
  });

  it('req-id-not-found returns unchanged with the reason', () => {
    const res = applyContentAmendment(SAMPLE, 'REQ-NOPE-999', 'x', 'y');
    expect(res.changed).toBe(false);
    expect(res.reason).toBe('req-id-not-found');
  });
});

describe('amendSpecFile wrapper', () => {
  it('reads, transforms, and writes when the mutator reports a change', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'specship-amend-'));
    const spec = path.join(dir, 'req-auth-001.md');
    fs.writeFileSync(spec, SAMPLE);
    const out = amendSpecFile(dir, spec, (src) =>
      appendAcceptanceCriterion(src, 'REQ-AUTH-001', 'REQ-AUTH-001.A2', 'New crit.'),
    );
    expect(out.ok).toBe(true);
    expect(out.changed).toBe(true);
    expect(fs.readFileSync(spec, 'utf8')).toContain('<!-- id: REQ-AUTH-001.A2 -->');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('refuses paths that escape the project root', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'specship-amend-esc-'));
    const outside = path.join(os.tmpdir(), 'outside.md');
    const out = amendSpecFile(dir, outside, () => ({ changed: true, source: 'x' }));
    expect(out.ok).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
