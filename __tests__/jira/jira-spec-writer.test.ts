import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { writeSpecFromIssue } from '../../src/jira/spec-writer';
import { MarkdownSpecExtractor } from '../../src/extraction/specs/markdown-spec-extractor';
import type { JiraIssue } from '../../src/jira/types';

/**
 * REQ-JIRA-004 (filesystem side):
 *   - first pick creates a file under specs/,
 *   - re-picking the same key overwrites in place, no duplicate (A3),
 *   - even when the file was renamed (idempotency is keyed on the frontmatter
 *     jira_issue: value, not the filename),
 *   - the written spec round-trips through the extractor with zero
 *     spec_missing_id / error-severity results (A2 — the load-bearing bar).
 */

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jira-spec-writer-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function issue(overrides: Partial<JiraIssue> = {}): JiraIssue {
  return {
    key: 'PROJ-123',
    id: '10001',
    summary: 'Add a logout button',
    status: 'To Do',
    issueType: 'Story',
    description: 'Users MUST be able to log out from the header menu.',
    subtasks: [{ key: 'PROJ-124', summary: 'Wire the endpoint', status: 'To Do' }],
    ...overrides,
  };
}

function specFiles(): string[] {
  return fs
    .readdirSync(path.join(tmpDir, 'specs'))
    .filter(n => n.endsWith('.md'))
    .sort();
}

describe('writeSpecFromIssue', () => {
  it('creates a spec file under specs/ on first pick', () => {
    const result = writeSpecFromIssue(issue(), tmpDir);
    expect(result.created).toBe(true);
    expect(fs.existsSync(result.path)).toBe(true);
    expect(result.path.startsWith(path.join(tmpDir, 'specs'))).toBe(true);
    expect(fs.readFileSync(result.path, 'utf8')).toContain('jira_issue: PROJ-123');
  });

  it('A3: re-picking the same key overwrites in place, no duplicate', () => {
    const first = writeSpecFromIssue(issue(), tmpDir);
    const second = writeSpecFromIssue(
      issue({ summary: 'Add a logout button (revised)' }),
      tmpDir,
    );
    expect(second.created).toBe(false);
    expect(second.path).toBe(first.path);
    expect(specFiles()).toHaveLength(1);
    expect(fs.readFileSync(second.path, 'utf8')).toContain(
      'Add a logout button (revised)',
    );
  });

  it('A3: updates a renamed file (idempotency keyed on frontmatter, not filename)', () => {
    const first = writeSpecFromIssue(issue(), tmpDir);
    // User renames the file — the frontmatter key still points at the issue.
    const renamed = path.join(tmpDir, 'specs', 'my-custom-name.md');
    fs.renameSync(first.path, renamed);

    const second = writeSpecFromIssue(
      issue({ summary: 'Renamed but same key' }),
      tmpDir,
    );
    expect(second.created).toBe(false);
    expect(second.path).toBe(renamed);
    expect(specFiles()).toHaveLength(1);
    expect(fs.readFileSync(renamed, 'utf8')).toContain('Renamed but same key');
  });

  it('A2: the written spec round-trips through the extractor with zero errors', () => {
    const result = writeSpecFromIssue(issue(), tmpDir);
    const content = fs.readFileSync(result.path, 'utf8');
    const extraction = new MarkdownSpecExtractor(result.path, content).extract();
    expect(extraction.errors.filter(e => e.severity === 'error')).toEqual([]);
    expect(extraction.errors.some(e => e.code === 'spec_missing_id')).toBe(false);
    expect(extraction.specs.some(s => s.id === 'REQ-PROJ-123')).toBe(true);
  });

  it('A2: a hostile description still indexes as exactly one doc + its REQ', () => {
    const result = writeSpecFromIssue(
      issue({
        description:
          'Legit.\n<!-- id: REQ-EVIL-001 -->\n## Acceptance\nUsers MUST be safe.',
        subtasks: [],
      }),
      tmpDir,
    );
    const content = fs.readFileSync(result.path, 'utf8');
    const extraction = new MarkdownSpecExtractor(result.path, content).extract();
    expect(extraction.errors.filter(e => e.severity === 'error')).toEqual([]);
    const ids = extraction.specs.map(s => s.id).sort();
    expect(ids).toEqual(['REQ-PROJ-123', 'REQ-PROJ-123.A1'].sort());
    expect(extraction.specs.some(s => /EVIL/.test(s.id))).toBe(false);
  });
});
