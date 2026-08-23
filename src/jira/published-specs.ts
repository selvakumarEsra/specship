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
  /**
   * Requirement id when the identity came from a per-requirement key
   * (`jira_issue_<id>` in a multi-requirement file, REQ-JIRATEAM-010).
   * Absent for the plain file-level `jira_issue:` form.
   */
  specId?: string;
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
 * Parse per-requirement identity lines out of the leading frontmatter block:
 * `jira_issue_<REQ-ID>: KEY` (+ optional matching `jira_fingerprint_<REQ-ID>`).
 */
function readPerSpecIdentities(
  content: string,
): Array<{ specId: string; issueKey: string; fingerprint: string | null }> {
  const lines = content.split(/\r?\n/);
  if ((lines[0] ?? '').trim() !== '---') return [];
  const out: Array<{ specId: string; issueKey: string; fingerprint: string | null }> = [];
  for (let i = 1; i < lines.length; i++) {
    const line = (lines[i] ?? '').trim();
    if (line === '---') break;
    const m = line.match(/^jira_issue_(\S+):\s*(.+)$/);
    if (!m) continue;
    const specId = m[1]!;
    const issueKey = m[2]!.trim().replace(/^["']|["']$/g, '');
    if (!issueKey) continue;
    out.push({
      specId,
      issueKey,
      fingerprint: readFrontmatterValue(content, `jira_fingerprint_${specId}`),
    });
  }
  return out;
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
      if (issueKey) {
        out.push({
          issueKey,
          title: readSpecTitle(full, issueKey),
          specRelPath: path.join('specs', name),
          fingerprint: readFrontmatterValue(content, 'jira_fingerprint'),
          absPath: full,
        });
      }
      // Per-requirement identities in multi-requirement files
      // (REQ-JIRATEAM-010.A5): one ref per `jira_issue_<REQ-ID>:` line so
      // coverage/track attribute each issue to its own requirement.
      for (const ref of readPerSpecIdentities(content)) {
        out.push({
          issueKey: ref.issueKey,
          title: readSpecTitle(full, ref.issueKey),
          specRelPath: path.join('specs', name),
          fingerprint: ref.fingerprint,
          absPath: full,
          specId: ref.specId,
        });
      }
    } catch {
      continue;
    }
  }
  return out;
}
