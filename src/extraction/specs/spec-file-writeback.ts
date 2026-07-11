/**
 * Spec-file write-back for asserted links (LINK-TRUTH-DOC, REQ-LINKWB-001).
 *
 * The spec FILE is the source of truth for a link assertion: a DB-only link
 * vanishes on a full reindex, is invisible to git, and can't be reviewed in a
 * PR. `specship_link_assert` therefore persists every assertion into the
 * requirement's `implementations:` block; the parser re-asserts it on every
 * index, making the link reindex-proof and clone-safe.
 *
 * Pure text transformation here (testable without fs); the fs wrapper at the
 * bottom is what the MCP handler calls.
 */

import * as fs from 'fs';
import * as path from 'path';

/** The same bullet pattern the markdown spec extractor matches. */
const IMPL_BULLET = /^\s*[-*]\s+([^\s:]+)\s*:\s*([A-Za-z0-9_$.]+)\s*$/;
const ID_MARKER = /^\s*<!--\s*id:\s*([^\s]+)\s*-->\s*$/;
const HEADING = /^#{1,6}\s+/;

export interface WriteBackResult {
  /** True when the source was modified (false = already present / not found). */
  changed: boolean;
  source: string;
  /** Why nothing changed, when it didn't. */
  reason?: 'already-present' | 'spec-id-not-found';
}

/**
 * Insert `targetFilePath:targetQualifiedName` into the `implementations:`
 * block of the section identified by `<!-- id: specId -->`, creating the
 * block when absent. Idempotent: re-asserting an already-listed target
 * returns the source byte-identical (REQ-LINKWB-001.A2).
 */
export function addImplementationToSpecSource(
  source: string,
  specId: string,
  targetFilePath: string,
  targetQualifiedName: string
): WriteBackResult {
  const lines = source.split('\n');

  // 1. Find the requirement's ID marker.
  let markerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = (lines[i] ?? '').match(ID_MARKER);
    if (m && m[1] === specId) { markerIdx = i; break; }
  }
  if (markerIdx === -1) {
    return { changed: false, source, reason: 'spec-id-not-found' };
  }

  // 2. The requirement's BODY runs from the line after its heading to the
  //    first structural boundary: the next heading (e.g. `## Acceptance`) or
  //    the next `<!-- id: -->` marker (a sibling REQ or an acceptance bullet).
  let bodyStart = markerIdx + 1;
  if (bodyStart < lines.length && HEADING.test(lines[bodyStart] ?? '')) bodyStart++;
  let bodyEnd = lines.length;
  for (let i = bodyStart; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (HEADING.test(line) || ID_MARKER.test(line)) { bodyEnd = i; break; }
  }

  // 3. Existing `implementations:` block inside the body?
  let implIdx = -1;
  for (let i = bodyStart; i < bodyEnd; i++) {
    if (/^implementations:\s*$/.test(lines[i] ?? '')) { implIdx = i; break; }
  }

  const bullet = `  - ${targetFilePath}:${targetQualifiedName}`;

  if (implIdx !== -1) {
    // Walk the block's bullets; bail if the target is already listed.
    let lastBullet = implIdx;
    for (let i = implIdx + 1; i < bodyEnd; i++) {
      const m = (lines[i] ?? '').match(IMPL_BULLET);
      if (!m) break;
      if (m[1] === targetFilePath && m[2] === targetQualifiedName) {
        return { changed: false, source, reason: 'already-present' };
      }
      lastBullet = i;
    }
    lines.splice(lastBullet + 1, 0, bullet);
    return { changed: true, source: lines.join('\n') };
  }

  // 4. No block — create one at the end of the body, trimming trailing blank
  //    lines so the block sits right after the prose (REQ-LINKWB-001.A3).
  let insertAt = bodyEnd;
  while (insertAt > bodyStart && (lines[insertAt - 1] ?? '').trim() === '') insertAt--;
  const block = ['', 'implementations:', bullet];
  // Keep one blank line between the block and whatever follows.
  if (insertAt < lines.length && lines[insertAt]?.trim() !== '') block.push('');
  lines.splice(insertAt, 0, ...block);
  return { changed: true, source: lines.join('\n') };
}

/**
 * Fs wrapper: apply the write-back to the spec's on-disk file. Returns a
 * human-readable outcome; never throws (an assert must not fail because the
 * file write did — the DB link still landed and the caller reports both).
 */
export function writeBackImplementation(
  projectRoot: string,
  specSourcePath: string,
  specId: string,
  targetFilePath: string,
  targetQualifiedName: string
): { ok: boolean; changed: boolean; detail: string } {
  try {
    const abs = path.isAbsolute(specSourcePath)
      ? specSourcePath
      : path.join(projectRoot, specSourcePath);
    // Refuse to follow a path that escapes the project root.
    const rel = path.relative(projectRoot, abs);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      return { ok: false, changed: false, detail: `spec source resolves outside project root: ${specSourcePath}` };
    }
    const source = fs.readFileSync(abs, 'utf-8');
    const res = addImplementationToSpecSource(source, specId, targetFilePath, targetQualifiedName);
    if (!res.changed) {
      return {
        ok: res.reason !== 'spec-id-not-found',
        changed: false,
        detail: res.reason === 'already-present'
          ? 'implementations: block already lists this target'
          : `marker <!-- id: ${specId} --> not found in ${specSourcePath}`,
      };
    }
    fs.writeFileSync(abs, res.source, 'utf-8');
    return { ok: true, changed: true, detail: `implementations: entry written to ${specSourcePath}` };
  } catch (err) {
    return { ok: false, changed: false, detail: err instanceof Error ? err.message : String(err) };
  }
}
