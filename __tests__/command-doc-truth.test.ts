/**
 * Shipped slash-command documentation must describe surfaces that exist.
 *
 * REQ-REVINT-001 — every authoring path in `/specship:spec` names the
 * `verifies:` block (the only thing that creates a tests-kind link), and the
 * post-write structural checklist covers test evidence.
 * REQ-SURF-002.A2 — `/specship:learn` no longer sends users to a dashboard
 * Improvements page that does not exist.
 *
 * Test bodies are named functions so a spec's `verifies:` block can point at
 * them — an it() title is a string, not a linkable symbol.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const COMMANDS = path.join(__dirname, '..', 'commands', 'specship');
const read = (name: string): string =>
  fs.readFileSync(path.join(COMMANDS, name), 'utf-8');

/** The body of a `## <heading>` section, up to the next `## ` heading. */
function section(doc: string, heading: string): string {
  const start = doc.indexOf(`## ${heading}`);
  expect(start, `section "${heading}" should exist`).toBeGreaterThan(-1);
  const rest = doc.slice(start + 3);
  const end = rest.indexOf('\n## ');
  return end === -1 ? rest : rest.slice(0, end);
}

describe('/specship:spec documents the verifies: block (REQ-REVINT-001)', () => {
  function newPathNamesVerifiesBlock(): void {
    const author = section(read('spec.md'), 'Author (`new <description | brief:<slug>>`)');
    expect(author).toContain('verifies:');
    expect(author).toContain('path:Symbol');
    expect(author).toContain('tests`-kind link');
    // The linkable-target caveat: a named function, not an it() title.
    expect(author).toMatch(/named function/);
  }

  function fastPathNamesVerifiesBlock(): void {
    const fast = section(read('spec.md'), 'Fast-path (`fast <description>`)');
    expect(fast).toContain('verifies:');
    expect(fast).toContain('path:Symbol');
    expect(fast).toMatch(/gates promotion to `verified`/);
  }

  function postWriteChecklistCoversTestEvidence(): void {
    const doc = read('spec.md');
    // The rubric the post-write review walks lives in the Review section.
    expect(doc).toMatch(/test-evidence\s+declared via `verifies:` or explicitly deferred/);
    const postWrite = section(doc, 'Post-write review (automatic, every authoring path)');
    expect(postWrite).toContain('verifies:');
  }

  it(
    'the new authoring path names verifies: with path:Symbol syntax (REQ-REVINT-001.A1)',
    newPathNamesVerifiesBlock,
  );
  it(
    'the fast path names verifies: with path:Symbol syntax (REQ-REVINT-001.A1)',
    fastPathNamesVerifiesBlock,
  );
  it(
    'the post-write structural checklist covers test evidence (REQ-REVINT-001.A2)',
    postWriteChecklistCoversTestEvidence,
  );
});

describe('/specship:learn points at a surface that exists (REQ-SURF-002.A2)', () => {
  function learnNamesNoImprovementsPage(): void {
    expect(read('learn.md')).not.toMatch(/Improvements page/i);
  }

  function learnNamesTheCliReviewPath(): void {
    expect(read('learn.md')).toContain('specship reflect');
  }

  it('no longer sends the user to a dashboard Improvements page', learnNamesNoImprovementsPage);
  it('names the CLI review path instead', learnNamesTheCliReviewPath);
});
