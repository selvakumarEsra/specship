/**
 * JIRA issue → SpecShip spec markdown (REQ-JIRA-004).
 *
 * A "pick" turns a fetched issue into a well-formed, low-ceremony spec:
 * the summary becomes the title, the description becomes an RFC-2119
 * requirement body, and each subtask becomes an acceptance bullet. The
 * generated markdown mirrors the `MarkdownSpecExtractor` contract exactly
 * (frontmatter, `<!-- id: -->` markers, `## Acceptance` container, id-marked
 * bullets) so it indexes with zero `spec_missing_id`/error results (A2).
 *
 * SECURITY: the issue summary / description / subtask summaries are UNTRUSTED
 * content being embedded into a spec file. A description that contains a
 * literal `<!-- id: REQ-EVIL-001 -->` marker or a `## Acceptance` / `# ` heading
 * must NOT be able to inject spec structure that corrupts the generated spec or,
 * on index, collides with another spec. `neutralizeLine` defuses those
 * sequences so the injected markers index as inert prose. This module is pure —
 * no I/O — and never handles or echoes any credential (REQ-JIRA-009).
 */

import type { JiraIssue } from './types';

/**
 * RFC-2119 keyword set. If the derived body already carries one of these, we
 * keep it as-is; otherwise we prefix a MUST sentence so the requirement is
 * always normative (A2 — the pipeline expects RFC-2119 keywords).
 */
const RFC2119 =
  /\b(MUST|MUST NOT|SHALL|SHALL NOT|SHOULD|SHOULD NOT|REQUIRED|MAY)\b/;

/**
 * Derive a stable, collision-safe requirement id from the FULL issue key
 * (unique within the connected JIRA). `PROJ-123` → `REQ-PROJ-123`. The key is
 * upper-cased and sanitized to `[A-Z0-9-]` so it is safe both as an id marker
 * and as a filename slug. Drives the `<!-- id: -->` marker AND idempotency.
 */
export function reqIdForIssue(key: string): string {
  const sanitized = key
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return `REQ-${sanitized || 'JIRA'}`;
}

/**
 * Neutralize a single line of UNTRUSTED issue text so it can't inject spec
 * structure when embedded in the generated markdown:
 *   - break HTML-comment markers (`<!-- id: … -->`) so they never match the
 *     extractor's `ID_COMMENT`, which would otherwise strand or re-parent nodes;
 *   - escape a leading heading run (`#`..`######`) so it never opens a new
 *     id-less section (which raises `spec_missing_id`) or a second `## Acceptance`
 *     container.
 * The line stays human-readable — the injected markers render as literal text.
 */
function neutralizeLine(line: string): string {
  let out = line.replace(/<!--/g, '&lt;!--').replace(/-->/g, '--&gt;');
  // Escape a leading heading marker: `## Acceptance` → `\## Acceptance`.
  out = out.replace(/^(\s*)(#{1,6})(\s+)/, '$1\\$2$3');
  return out;
}

/** Neutralize a multi-line block line-by-line, preserving paragraph breaks. */
function neutralizeBlock(text: string): string {
  return text.split(/\r?\n/).map(neutralizeLine).join('\n').trim();
}

/**
 * Collapse UNTRUSTED text to a single neutralized line — for the H1 title and
 * acceptance bullets, which must stay on one line. Newlines are folded to spaces
 * (so a multi-line summary can't spill into the next markdown construct) and the
 * result is neutralized. Returns `fallback` when the text is empty.
 */
function neutralizeInline(text: string, fallback: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  const safe = neutralizeLine(collapsed).trim();
  return safe || fallback;
}

/**
 * Derive the requirement body from the issue. If the (neutralized) description
 * already carries an RFC-2119 keyword we use it verbatim; otherwise we prefix a
 * MUST sentence built from the summary so the body is always normative and never
 * empty (A2).
 */
function deriveBody(issue: JiraIssue): string {
  const desc = neutralizeBlock(issue.description?.trim() ?? '');
  if (desc && RFC2119.test(desc)) return desc;

  const summary = neutralizeInline(issue.summary ?? '', issue.key);
  const must = `The implementation MUST satisfy JIRA issue ${issue.key}: ${summary}.`;
  return desc ? `${must}\n\n${desc}` : must;
}

/**
 * Derive acceptance bullets — one per subtask, or a single derived bullet when
 * the issue has none (never zero — A2). Each bullet id is `${reqId}.A<n>` so the
 * extractor parents it to the requirement by id suffix.
 */
function deriveAcceptance(issue: JiraIssue): Array<{ id: string; text: string }> {
  const reqId = reqIdForIssue(issue.key);
  const subs = issue.subtasks ?? [];
  if (subs.length > 0) {
    return subs.map((st, i) => ({
      id: `${reqId}.A${i + 1}`,
      text: neutralizeInline(st.summary ?? '', st.key || `Subtask ${i + 1}`),
    }));
  }
  return [
    {
      id: `${reqId}.A1`,
      text: `The behaviour described by ${issue.key} is implemented and verified against the issue.`,
    },
  ];
}

/**
 * Generate a full, well-formed spec document from a JIRA issue. The frontmatter
 * records the source key (`jira_issue:` — the A1 link + the idempotency key);
 * the H1 carries the requirement id marker; the `## Acceptance` container holds
 * one id-marked bullet per subtask.
 */
export function generateSpecMarkdown(issue: JiraIssue): string {
  const reqId = reqIdForIssue(issue.key);
  const title = neutralizeInline(issue.summary ?? '', issue.key);
  const body = deriveBody(issue);
  const acceptance = deriveAcceptance(issue);

  const lines: string[] = [
    '---',
    'format: markdown',
    `jira_issue: ${issue.key}`,
    '---',
    `<!-- id: ${reqId} -->`,
    `# ${title}`,
    '',
    body,
    '',
    '## Acceptance',
  ];
  for (const bullet of acceptance) {
    lines.push(`<!-- id: ${bullet.id} -->`);
    lines.push(`- ${bullet.text}`);
  }
  return lines.join('\n') + '\n';
}
