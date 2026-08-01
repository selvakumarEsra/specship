/**
 * Spec-file write-side for JIRA reconciliation (REQ-JIRATEAM-005.A4).
 *
 * Two operations, both pure text transforms with a thin fs wrapper:
 *   - `applyContentAmendment` rewrites the requirement's title/prose body from
 *     an edited-in-JIRA summary/description while preserving the leading
 *     frontmatter, the `implementations:` / `verifies:` blocks, and the
 *     `## Acceptance` section (never clobbered).
 *   - `appendAcceptanceCriterion` inserts a new id-marked bullet under the
 *     `## Acceptance` container of the target requirement.
 *
 * The transforms return the amended source bytes; callers persist the file and
 * re-publish so the frontmatter fingerprint refreshes.
 */

import * as fs from 'fs';
import * as path from 'path';

const ID_MARKER = /^\s*<!--\s*id\s*:\s*([^\s]+)\s*-->\s*$/;
const HEADING = /^(#{1,6})\s+(.+?)\s*$/;
const ACCEPTANCE_CONTAINER = /^##\s+acceptance\s*$/i;
const IMPL_BLOCK_HEADER = /^implementations:\s*$/;
const VERIFIES_BLOCK_HEADER = /^verifies:\s*$/;

export interface AmendResult {
  changed: boolean;
  source: string;
  reason?: 'req-id-not-found' | 'already-present';
}

/**
 * Find the `<!-- id: reqId -->`-marked heading and return the [start, end)
 * line range of its heading + body (up to but not including the next heading
 * of the same or shallower level, or the next `<!-- id: -->` marker at any
 * level). Returns `null` when the marker doesn't resolve to a heading.
 */
function findRequirementRange(
  lines: string[],
  reqId: string,
): { markerIdx: number; headingIdx: number; level: number; bodyEnd: number } | null {
  let markerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = (lines[i] ?? '').match(ID_MARKER);
    if (m && m[1] === reqId) {
      markerIdx = i;
      break;
    }
  }
  if (markerIdx === -1) return null;

  const headingIdx = markerIdx + 1;
  const headingMatch = (lines[headingIdx] ?? '').match(HEADING);
  if (!headingMatch || !headingMatch[1]) return null;
  const level = headingMatch[1].length;

  let bodyEnd = lines.length;
  for (let i = headingIdx + 1; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const h = line.match(HEADING);
    if (h && h[1] && h[1].length <= level) {
      bodyEnd = i;
      break;
    }
    if (ID_MARKER.test(line)) {
      bodyEnd = i;
      break;
    }
  }
  return { markerIdx, headingIdx, level, bodyEnd };
}

/**
 * Rewrite the requirement's H2 title and its prose paragraph(s) from the
 * edited-in-JIRA summary/description. Preserves the `## Acceptance` container
 * (if present), the `implementations:` and `verifies:` blocks, and every
 * child section. The prose window runs from the line after the heading up to
 * the first of: `## Acceptance`, `implementations:`, `verifies:`, a nested
 * id-marker, or a deeper heading — those all stay intact.
 */
export function applyContentAmendment(
  source: string,
  reqId: string,
  newTitle: string,
  newDescription: string,
): AmendResult {
  const lines = source.split('\n');
  const range = findRequirementRange(lines, reqId);
  if (!range) return { changed: false, source, reason: 'req-id-not-found' };

  const headingLine = lines[range.headingIdx] ?? '';
  const headingHash = '#'.repeat(range.level);
  const oldTitle = headingLine.replace(/^#+\s+/, '').trim();

  // Prose window: from headingIdx+1 up to (but not including) the first
  // structural landmark we must preserve.
  let proseEnd = range.bodyEnd;
  for (let i = range.headingIdx + 1; i < range.bodyEnd; i++) {
    const line = lines[i] ?? '';
    if (
      ACCEPTANCE_CONTAINER.test(line) ||
      IMPL_BLOCK_HEADER.test(line) ||
      VERIFIES_BLOCK_HEADER.test(line) ||
      HEADING.test(line) ||
      ID_MARKER.test(line)
    ) {
      proseEnd = i;
      break;
    }
  }

  const cleanedDescription = newDescription.replace(/\r\n/g, '\n').trimEnd();
  const cleanedTitle = newTitle.replace(/\r?\n/g, ' ').trim() || oldTitle;
  const newHeading = `${headingHash} ${cleanedTitle}`;
  const nextIsBlank = (lines[proseEnd] ?? '').trim() === '';
  const proseLines = cleanedDescription.length > 0
    ? ['', ...cleanedDescription.split('\n'), ...(nextIsBlank ? [] : [''])]
    : [''];

  const newHead = [newHeading, ...proseLines];
  const before = lines.slice(0, range.headingIdx);
  const after = lines.slice(proseEnd);
  const next = [...before, ...newHead, ...after].join('\n');
  if (next === source) return { changed: false, source, reason: 'already-present' };
  return { changed: true, source: next };
}

/**
 * Insert `- <!-- id: <criterionId> -->\n- <text>` under the requirement's
 * `## Acceptance` container. Creates the container when absent (appended to
 * the end of the requirement body). Idempotent: if a bullet with the same id
 * already exists, returns unchanged.
 */
export function appendAcceptanceCriterion(
  source: string,
  reqId: string,
  criterionId: string,
  criterionText: string,
): AmendResult {
  const lines = source.split('\n');
  const range = findRequirementRange(lines, reqId);
  if (!range) return { changed: false, source, reason: 'req-id-not-found' };

  // Idempotence: the id already appears anywhere in the file.
  for (const line of lines) {
    const m = line.match(ID_MARKER);
    if (m && m[1] === criterionId) {
      return { changed: false, source, reason: 'already-present' };
    }
  }

  // Locate the acceptance container (if any) inside the requirement body.
  let acceptanceIdx = -1;
  for (let i = range.headingIdx + 1; i < range.bodyEnd; i++) {
    if (ACCEPTANCE_CONTAINER.test(lines[i] ?? '')) {
      acceptanceIdx = i;
      break;
    }
  }

  const marker = `<!-- id: ${criterionId} -->`;
  const bullet = `- ${criterionText.replace(/\s+/g, ' ').trim()}`;

  if (acceptanceIdx === -1) {
    // Create a fresh acceptance section at the end of the body, trimming any
    // trailing blank lines so the new block sits flush.
    let insertAt = range.bodyEnd;
    while (insertAt > range.headingIdx + 1 && (lines[insertAt - 1] ?? '').trim() === '') {
      insertAt--;
    }
    const block = ['', '## Acceptance', marker, bullet];
    if (insertAt < lines.length && (lines[insertAt] ?? '').trim() !== '') block.push('');
    lines.splice(insertAt, 0, ...block);
    return { changed: true, source: lines.join('\n') };
  }

  // Append at the end of the acceptance container. The container ends at the
  // first heading of the same-or-shallower level, or the requirement's
  // bodyEnd.
  let acceptEnd = range.bodyEnd;
  for (let i = acceptanceIdx + 1; i < range.bodyEnd; i++) {
    const h = (lines[i] ?? '').match(HEADING);
    if (h && h[1] && h[1].length <= 2) {
      acceptEnd = i;
      break;
    }
  }
  let insertAt = acceptEnd;
  while (insertAt > acceptanceIdx + 1 && (lines[insertAt - 1] ?? '').trim() === '') {
    insertAt--;
  }
  const block = [marker, bullet];
  lines.splice(insertAt, 0, ...block);
  return { changed: true, source: lines.join('\n') };
}

/**
 * Fs wrapper: read the spec file, apply `mutator`, and write it back when the
 * result changed. Refuses paths that escape `projectRoot`. Never throws — a
 * malformed spec or a write error is returned as `{ ok: false }`.
 */
export function amendSpecFile(
  projectRoot: string,
  specSourcePath: string,
  mutator: (source: string) => AmendResult,
): { ok: boolean; changed: boolean; detail: string } {
  try {
    const abs = path.isAbsolute(specSourcePath)
      ? specSourcePath
      : path.join(projectRoot, specSourcePath);
    const rel = path.relative(projectRoot, abs);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      return { ok: false, changed: false, detail: `spec source resolves outside project root: ${specSourcePath}` };
    }
    const source = fs.readFileSync(abs, 'utf-8');
    const res = mutator(source);
    if (!res.changed) {
      return {
        ok: res.reason !== 'req-id-not-found',
        changed: false,
        detail: res.reason ?? 'no change',
      };
    }
    fs.writeFileSync(abs, res.source, 'utf-8');
    return { ok: true, changed: true, detail: `amended ${specSourcePath}` };
  } catch (err) {
    return { ok: false, changed: false, detail: err instanceof Error ? err.message : String(err) };
  }
}
