/**
 * Enumerate specs under `<projectRoot>/specs/` that carry a published JIRA
 * identity (REQ-JIRAPUB-008 / REQ-JIRATEAM-004). Shared between the tracking
 * view (`specship_jira_track`) and the sprint coverage report
 * (`specship_jira_coverage`) so both surface the same source of "which specs
 * are JIRA-backed".
 */

import * as fs from 'fs';
import * as path from 'path';
import { readFrontmatterValue } from './publish';

/** A spec under specs/ that carries a published JIRA identity. */
export interface PublishedSpecRef {
  issueKey: string;
  title: string;
  specRelPath: string;
  fingerprint: string | null;
  /** Absolute path — callers use it to feed the spec-link state machine. */
  absPath: string;
}

/**
 * Read the H1 title out of a spec file, falling back to `fallback`. Small,
 * self-contained so this module has no back-dependency on jira-tools.ts.
 */
function readSpecTitle(specPath: string, fallback: string): string {
  try {
    const content = fs.readFileSync(specPath, 'utf8');
    for (const raw of content.split(/\r?\n/)) {
      const line = raw.trim();
      const m = line.match(/^#\s+(.+)$/);
      if (m) return m[1]!.trim() || fallback;
    }
  } catch {
    /* fall through to the fallback */
  }
  return fallback;
}

/**
 * Best-effort filesystem scan for specs whose frontmatter carries a
 * `jira_issue:` key. Unreadable files are skipped and a missing specs/ dir
 * yields an empty list — never a throw.
 */
export function enumeratePublishedSpecs(projectRoot: string): PublishedSpecRef[] {
  const specsDir = path.join(projectRoot, 'specs');
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(specsDir);
  } catch {
    return [];
  }
  const out: PublishedSpecRef[] = [];
  for (const name of entries) {
    if (!name.toLowerCase().endsWith('.md')) continue;
    const full = path.join(specsDir, name);
    try {
      if (!fs.statSync(full).isFile()) continue;
      const content = fs.readFileSync(full, 'utf8');
      const issueKey = readFrontmatterValue(content, 'jira_issue');
      if (!issueKey) continue;
      out.push({
        issueKey,
        title: readSpecTitle(full, issueKey),
        specRelPath: path.join('specs', name),
        fingerprint: readFrontmatterValue(content, 'jira_fingerprint'),
        absPath: full,
      });
    } catch {
      continue;
    }
  }
  return out;
}
