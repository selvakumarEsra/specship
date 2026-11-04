/**
 * Readable prose from a requirement body (REQ-DASHSIMPLE-003.A7,
 * REQ-DASHSIMPLE-005.A6). A raw spec body carries machine syntax a reader
 * should never see as text: `<!-- id: … -->` markers, the `## Acceptance`
 * section (its criteria are shown as the story's tasks instead) and the
 * `implementations:` / `verifies:` link blocks. Pure and shared by the Plan
 * reader and the Graph split view, so both apply the same rules.
 */

const ID_MARKER = /<!--\s*id:[\s\S]*?-->/g;
const FENCE = /^\s*(```|~~~)/;
const HEADING = /^#{1,6}\s/;
const ACCEPTANCE = /^#{1,6}\s+Acceptance\b/i;
const LINK_LABEL = /^(implementations|verifies):/;
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s/;

/**
 * Strip markers, the acceptance section and link blocks; collapse the blank
 * lines they leave behind. Fenced code is passed through untouched.
 */
// @implements REQ-DASHSIMPLE-003
// @implements REQ-DASHSIMPLE-005
export function specProse(body: string): string {
  const out: string[] = [];
  let inFence = false;
  let skip: 'none' | 'acceptance' | 'links' = 'none';
  for (const raw of String(body ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    if (inFence) {
      if (skip !== 'acceptance') out.push(raw);
      if (FENCE.test(raw)) inFence = false;
      continue;
    }
    if (skip === 'links') {
      // A link block runs over its bullets / indented lines and ends at the
      // first blank or unindented, non-bullet line (which is then kept).
      if (raw.trim() !== '' && (/^\s/.test(raw) || LIST_ITEM.test(raw))) continue;
      skip = 'none';
    }
    if (skip === 'acceptance') {
      // The section ends at the next heading that is not itself Acceptance.
      if (!HEADING.test(raw) || ACCEPTANCE.test(raw)) {
        if (FENCE.test(raw)) inFence = true;
        continue;
      }
      skip = 'none';
    }
    if (ACCEPTANCE.test(raw)) { skip = 'acceptance'; continue; }
    if (LINK_LABEL.test(raw)) { skip = 'links'; continue; }
    if (FENCE.test(raw)) { inFence = true; out.push(raw); continue; }
    const line = raw.replace(ID_MARKER, '');
    // A line that held only a marker disappears instead of leaving a gap.
    if (line.trim() === '' && raw.trim() !== '') continue;
    out.push(line.replace(/\s+$/, ''));
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * The cleaned body as paragraphs, one per blank-line-separated block.
 * Hard-wrapped lines inside a paragraph are joined with a space; list items
 * keep their own line (render with `white-space: pre-line`).
 */
// @implements REQ-DASHSIMPLE-003
// @implements REQ-DASHSIMPLE-005
export function specParagraphs(body: string): string[] {
  const prose = specProse(body);
  if (!prose) return [];
  return prose.split(/\n\s*\n/).map((block) => {
    const lines = block.split('\n');
    let text = lines[0] ?? '';
    for (const l of lines.slice(1)) text += LIST_ITEM.test(l) ? '\n' + l.trim() : ' ' + l.trim();
    return text.trim();
  });
}
