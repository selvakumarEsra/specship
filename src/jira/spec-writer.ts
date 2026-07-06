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
