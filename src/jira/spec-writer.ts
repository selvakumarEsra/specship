/**
 * JIRA issue → spec file on disk (REQ-JIRA-004).
 *
 * `writeSpecFromIssue` resolves the project's `specs/` directory, generates the
 * spec markdown from the issue, and writes it idempotently (A3). Idempotency is
 * keyed on the frontmatter `jira_issue:` value — parsed from a real frontmatter
 * block, NOT grepped from the body (which could match the key in prose) — so a
 * re-pick of the same issue overwrites the existing file even if it was renamed,
 * and never leaves a duplicate. Pure filesystem side of the feature; it handles
 * no credential (REQ-JIRA-009).
 */

import * as fs from 'fs';
import * as path from 'path';
import type { JiraIssue } from './types';
import { generateSpecMarkdown, reqIdForIssue } from './spec-generator';

export interface WriteSpecResult {
  /** Absolute path of the written spec file. */
  path: string;
  /** True when a new file was created; false when an existing one was updated. */
  created: boolean;
}

/**
 * Parse the `jira_issue:` value out of a spec file's leading frontmatter block.
 * Returns `null` when the file has no `---`-delimited frontmatter or no
 * `jira_issue:` key. A real (if minimal) frontmatter parse, so a `jira_issue:`
 * mention buried in the body can never be mistaken for the source key.
 */
function readJiraIssueKey(content: string): string | null {
  const lines = content.split(/\r?\n/);
  if ((lines[0] ?? '').trim() !== '---') return null;
  for (let i = 1; i < lines.length; i++) {
    const line = (lines[i] ?? '').trim();
    if (line === '---') break; // end of frontmatter
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim();
    if (key !== 'jira_issue') continue;
    let value = line.slice(colon + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    return value.length > 0 ? value : null;
  }
  return null;
}

/**
 * Read the `jira_issue:` key of a spec FILE (REQ-JIRAPUB-004): the JIRA
 * identity commits and tracking key on. Returns `null` for a file without
 * frontmatter, without the key, or that can't be read — a key mentioned only
 * in the body never matches (same guarantee as `readJiraIssueKey`).
 */
export function readSpecJiraKey(specPath: string): string | null {
  try {
    return readJiraIssueKey(fs.readFileSync(specPath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Find the spec file (if any) whose frontmatter records `issueKey`, scanning
 * `<projectRoot>/specs/`. Returns the absolute path, or `null` when no spec for
 * the key exists. Keyed on the parsed `jira_issue:` frontmatter value — never a
 * body match — so it locates the exact file a pick wrote even if it was renamed.
 * Shared by `writeSpecFromIssue` (idempotent overwrite) and `specship_jira_start`
 * (does a spec for this key exist yet?).
 */
export function findSpecForIssueKey(
  issueKey: string,
  projectRoot: string,
): string | null {
  const specsDir = path.join(projectRoot, 'specs');
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(specsDir);
  } catch {
    return null;
  }
  for (const name of entries) {
    if (!name.toLowerCase().endsWith('.md')) continue;
    const full = path.join(specsDir, name);
    try {
      if (!fs.statSync(full).isFile()) continue;
      if (readJiraIssueKey(fs.readFileSync(full, 'utf8')) === issueKey) {
        return full;
      }
    } catch {
      continue;
    }
  }
  return null;
}

/** A filesystem-safe slug for the default filename, from the issue key. */
function slugForKey(key: string): string {
  return (
    reqIdForIssue(key)
      .replace(/^REQ-/, '')
      .toLowerCase() || 'issue'
  );
}

/**
 * Generate and write a spec for `issue` under `<projectRoot>/specs/`, creating
 * the directory if needed. If an existing spec already records this issue key in
 * its frontmatter, that file is overwritten (keyed on the key, not the filename,
 * so a renamed file still updates); otherwise a new `specs/jira-<slug>.md` is
 * created.
 */
export function writeSpecFromIssue(
  issue: JiraIssue,
  projectRoot: string,
): WriteSpecResult {
  const specsDir = path.join(projectRoot, 'specs');
  fs.mkdirSync(specsDir, { recursive: true });

  const markdown = generateSpecMarkdown(issue);

  // Idempotency (A3): find an existing spec whose frontmatter records this key.
  const existing = findSpecForIssueKey(issue.key, projectRoot);

  if (existing) {
    fs.writeFileSync(existing, markdown, 'utf8');
    return { path: existing, created: false };
  }

  const target = path.join(specsDir, `jira-${slugForKey(issue.key)}.md`);
  const created = !fs.existsSync(target);
  fs.writeFileSync(target, markdown, 'utf8');
  return { path: target, created };
}

// ---------------------------------------------------------------------------
// Regression-pack back-link (REQ-JIRAREG-001.A3)
// ---------------------------------------------------------------------------

const ID_MARKER_LINE = /^\s*<!--\s*id:\s*([^\s]+)\s*-->\s*$/;
const REG_BULLET = /^\s*[-*]\s+([A-Z][A-Z0-9]+-\d+)\s*$/;
const SECTION_HEADING = /^#{1,6}\s+/;
const SPEC_KEYWORD_BLOCK = /^(implementations|verifies|regression_cases):\s*$/;

/**
 * Insert or update a `regression_cases:` back-link under the acceptance
 * criterion marked `<!-- id: criterionId -->` (REQ-JIRAREG-001.A3). The block
 * is trace-only metadata the markdown spec extractor ignores by design —
 * `implementations:` and `verifies:` are the only keywords the extractor
 * recognises, so a `regression_cases:` block cannot silently absorb their
 * bullets. Idempotent: a re-run with the same key is a no-op.
 *
 * Returns `{ ok, changed, detail }` mirroring `writeBackImplementation`;
 * never throws past a read/write failure.
 */
export function writeRegressionCaseKeys(
  specPath: string,
  criterionId: string,
  issueKey: string,
): { ok: boolean; changed: boolean; detail: string } {
  try {
    const source = fs.readFileSync(specPath, 'utf8');
    const res = addRegressionCaseKeyToSource(source, criterionId, issueKey);
    if (!res.changed) {
      return {
        ok: res.reason !== 'criterion-id-not-found',
        changed: false,
        detail:
          res.reason === 'already-present'
            ? 'regression_cases: block already lists this key'
            : `marker <!-- id: ${criterionId} --> not found in ${specPath}`,
      };
    }
    fs.writeFileSync(specPath, res.source, 'utf8');
    return {
      ok: true,
      changed: true,
      detail: `regression_cases: entry written to ${specPath}`,
    };
  } catch (err) {
    return {
      ok: false,
      changed: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Pure text transform — extracted so the extractor-safety test drives it directly. */
export function addRegressionCaseKeyToSource(
  source: string,
  criterionId: string,
  issueKey: string,
): { changed: boolean; source: string; reason?: 'already-present' | 'criterion-id-not-found' } {
  const lines = source.split('\n');

  let markerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = (lines[i] ?? '').match(ID_MARKER_LINE);
    if (m && m[1] === criterionId) {
      markerIdx = i;
      break;
    }
  }
  if (markerIdx === -1) {
    return { changed: false, source, reason: 'criterion-id-not-found' };
  }

  // Body of a criterion ends at the next id marker or heading — same
  // structural boundary the extractor uses.
  const bodyStart = markerIdx + 1;
  let bodyEnd = lines.length;
  for (let i = bodyStart; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (SECTION_HEADING.test(line) || ID_MARKER_LINE.test(line)) {
      bodyEnd = i;
      break;
    }
  }

  let blockIdx = -1;
  for (let i = bodyStart; i < bodyEnd; i++) {
    if (/^regression_cases:\s*$/.test(lines[i] ?? '')) {
      blockIdx = i;
      break;
    }
  }

  const bullet = `  - ${issueKey}`;

  if (blockIdx !== -1) {
    let lastBullet = blockIdx;
    for (let i = blockIdx + 1; i < bodyEnd; i++) {
      const line = lines[i] ?? '';
      if (line.trim() === '') break;
      const m = line.match(REG_BULLET);
      if (!m) {
        // Any non-matching non-blank line terminates the block cleanly —
        // in particular an `implementations:` / `verifies:` keyword just
        // below cannot be swept in.
        if (SPEC_KEYWORD_BLOCK.test(line.trim())) break;
        break;
      }
      if (m[1] === issueKey) {
        return { changed: false, source, reason: 'already-present' };
      }
      lastBullet = i;
    }
    lines.splice(lastBullet + 1, 0, bullet);
    return { changed: true, source: lines.join('\n') };
  }

  // No block yet — insert one, terminated by a blank line so the extractor's
  // next-keyword scan cannot bleed across it.
  let insertAt = bodyEnd;
  while (insertAt > bodyStart && (lines[insertAt - 1] ?? '').trim() === '') insertAt--;
  const block = ['', 'regression_cases:', bullet, ''];
  lines.splice(insertAt, 0, ...block);
  return { changed: true, source: lines.join('\n') };
}
