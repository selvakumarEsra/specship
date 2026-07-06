import { describe, it, expect } from 'vitest';
import {
  generateSpecMarkdown,
  reqIdForIssue,
} from '../../src/jira/spec-generator';
import { MarkdownSpecExtractor } from '../../src/extraction/specs/markdown-spec-extractor';
import type { JiraIssue } from '../../src/jira/types';

/**
 * REQ-JIRA-004 — the pure issue→spec-markdown generator:
 *   - title / body / acceptance derived from the issue,
 *   - frontmatter records the source key (A1),
 *   - subtasks → bullets, with a no-subtask fallback (never zero — A2),
 *   - an RFC-2119 keyword is always present in the body,
 *   - UNTRUSTED issue text cannot inject spec structure (the security bar).
 */

function issue(overrides: Partial<JiraIssue> = {}): JiraIssue {
  return {
    key: 'PROJ-123',
    id: '10001',
    summary: 'Add a logout button',
    status: 'To Do',
    issueType: 'Story',
    description: 'Users MUST be able to log out from the header menu.',
    subtasks: [
      { key: 'PROJ-124', summary: 'Wire the endpoint', status: 'To Do' },
      { key: 'PROJ-125', summary: 'Add the button', status: 'To Do' },
    ],
    ...overrides,
  };
}

describe('reqIdForIssue', () => {
  it('derives a stable REQ id from the full issue key', () => {
    expect(reqIdForIssue('PROJ-123')).toBe('REQ-PROJ-123');
    expect(reqIdForIssue('abc-9')).toBe('REQ-ABC-9');
  });

  it('sanitizes stray characters to [A-Z0-9-]', () => {
    expect(reqIdForIssue('WEIRD/12 3')).toBe('REQ-WEIRD-12-3');
  });
});

describe('generateSpecMarkdown', () => {
  it('A1: title, body, and acceptance derive from the issue; frontmatter records the key', () => {
    const md = generateSpecMarkdown(issue());
    expect(md).toContain('jira_issue: PROJ-123');
    expect(md).toContain('<!-- id: REQ-PROJ-123 -->');
    expect(md).toContain('# Add a logout button');
    expect(md).toContain('log out from the header menu');
    // one bullet per subtask, id-marked and parented by suffix
    expect(md).toContain('<!-- id: REQ-PROJ-123.A1 -->');
    expect(md).toContain('- Wire the endpoint');
    expect(md).toContain('<!-- id: REQ-PROJ-123.A2 -->');
    expect(md).toContain('- Add the button');
  });

  it('A2: derives a single acceptance bullet when the issue has no subtasks', () => {
    const md = generateSpecMarkdown(issue({ subtasks: [] }));
    expect(md).toContain('<!-- id: REQ-PROJ-123.A1 -->');
    expect(md).not.toContain('.A2');
    // never zero acceptance bullets
    expect(md).toMatch(/## Acceptance\n<!-- id: REQ-PROJ-123\.A1 -->\n- /);
  });

  it('A2: prefixes a MUST sentence when the description lacks an RFC-2119 keyword', () => {
    const md = generateSpecMarkdown(
      issue({ description: 'A short note with no normative language.' }),
    );
    expect(md).toMatch(/\bMUST\b/);
    // context still preserved
    expect(md).toContain('A short note with no normative language.');
  });

  it('A2: keeps the description verbatim when it already carries a keyword', () => {
    const md = generateSpecMarkdown(issue());
    // no manufactured "The implementation MUST satisfy" prefix when already normative
    expect(md).not.toContain('The implementation MUST satisfy');
  });

  it('extractor round-trips with zero spec_missing_id / error results (A2)', () => {
    const md = generateSpecMarkdown(issue());
    const result = new MarkdownSpecExtractor(
      'specs/jira-proj-123.md',
      md,
    ).extract();
    const errs = result.errors.filter(e => e.severity === 'error');
    expect(errs).toEqual([]);
    expect(result.errors.some(e => e.code === 'spec_missing_id')).toBe(false);
    // exactly one document + its acceptance criteria, all under the REQ id
    const ids = result.specs.map(s => s.id).sort();
    expect(ids).toEqual(
      ['REQ-PROJ-123', 'REQ-PROJ-123.A1', 'REQ-PROJ-123.A2'].sort(),
    );
  });

  it('SECURITY: injected id markers / headings in the description are inert', () => {
    const md = generateSpecMarkdown(
      issue({
        description:
          'Legit line.\n<!-- id: REQ-EVIL-001 -->\n## Acceptance\n# Injected H1\nUsers MUST see nothing hijacked.',
        subtasks: [
          { key: 'PROJ-200', summary: '<!-- id: REQ-EVIL-002 -->', status: 'To Do' },
        ],
      }),
    );
    const result = new MarkdownSpecExtractor(
      'specs/jira-proj-123.md',
      md,
    ).extract();

    // No error-severity results despite the injection attempt.
    expect(result.errors.filter(e => e.severity === 'error')).toEqual([]);

    // Exactly one doc + its own single acceptance criterion — no REQ-EVIL-* leaked in.
    const ids = result.specs.map(s => s.id).sort();
    expect(ids).toEqual(['REQ-PROJ-123', 'REQ-PROJ-123.A1'].sort());
    expect(result.specs.some(s => /EVIL/.test(s.id))).toBe(false);
  });
});
