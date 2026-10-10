/**
 * Suppression-comment scan (REQ-QGATE-004).
 *
 * Agents under pressure silence lint/type rules instead of fixing code — the
 * implement workflows forbid it in prose, but prose isn't enforcement. This
 * module detects suppression markers INTRODUCED by a change: a pure function
 * over unified diff text (A2), so the workflows' gate, `specship check`, and
 * tests all share one implementation.
 *
 * Ratchet semantics (A1): only added lines count, and an added line whose
 * exact content also appears among the diff's removed lines is a move, not an
 * introduction. Pre-existing suppressions are out of scope.
 */

export interface SuppressionFinding {
  /** Project-relative path of the file the suppression was added to. */
  file: string;
  /** 1-indexed line number in the new file. */
  line: number;
  /** Which marker family matched (e.g. `noqa`, `eslint-disable`). */
  marker: string;
  /** True when the suppression carries an inline justification. */
  justified: boolean;
  /** The added line, trimmed. */
  text: string;
}

/** File families a linter actually honors each marker in (precision guard). */
const JS_EXT = new Set(['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs', 'svelte', 'vue', 'astro']);
const PY_EXT = new Set(['py', 'pyi']);

/**
 * Marker families. Precision rules (A2): a marker only counts in a file type
 * its linter reads (`exts`) AND in comment position (`pos` must match the
 * line up to and including the marker) — a mention in prose, a YAML/markdown
 * doc, or a string literal is not a suppression. The first dogfood run of
 * this scanner flagged its own documentation; that false-positive class is
 * what these guards remove.
 */
// A directive is only honored at the START of its comment (eslint, tsc and
// biome all require this), so the regexes anchor there — a prose mention
// later in a comment is not a suppression.
const MARKERS: Array<{ marker: string; re: RegExp; exts: Set<string> }> = [
  { marker: 'eslint-disable', re: /^\s*eslint-disable(?:-next-line|-line)?\b/, exts: JS_EXT },
  { marker: '@ts-expect-error', re: /^\s*@ts-expect-error\b/, exts: JS_EXT },
  { marker: '@ts-ignore', re: /^\s*@ts-ignore\b/, exts: JS_EXT },
  { marker: 'biome-ignore', re: /^\s*biome-ignore\b/, exts: JS_EXT },
  { marker: 'type: ignore', re: /#\s*type:\s*ignore\b/, exts: PY_EXT },
  { marker: 'noqa', re: /#\s*noqa\b/, exts: PY_EXT },
];

function fileExt(file: string): string {
  const dot = file.lastIndexOf('.');
  return dot === -1 ? '' : file.slice(dot + 1).toLowerCase();
}

/**
 * The comment part of a line, or null when the line has none. Line-local
 * heuristic: a `//`, `/*` (JS families) or `#` (Python) opener counts only
 * when every quote character before it is balanced — an opener inside a
 * string literal is content, not a comment. Multi-line strings/comments are
 * out of reach for a diff-line scanner; linters need the marker on its own
 * statement line anyway, so line-local is where the real suppressions are.
 */
function commentPart(line: string, js: boolean): string | null {
  const openerAt = (idx: number): boolean => {
    const before = line.slice(0, idx);
    for (const q of ["'", '"', '`']) {
      if ((before.split(q).length - 1) % 2 === 1) return false;
    }
    return true;
  };
  const openers = js ? ['//', '/*'] : ['#'];
  let best = -1;
  for (const o of openers) {
    let i = line.indexOf(o);
    while (i !== -1) {
      if (openerAt(i)) { best = best === -1 ? i : Math.min(best, i); break; }
      i = line.indexOf(o, i + 1);
    }
  }
  return best === -1 ? null : line.slice(best);
}

/**
 * A suppression is "justified" when it carries an inline explanation in the
 * family's own syntax: eslint's ` -- reason`, biome-ignore's `: reason`.
 * Justified suppressions are still findings — the label exists so a reviewer
 * can triage, not so the gate waves them through.
 */
function isJustified(marker: string, line: string): boolean {
  if (marker === 'eslint-disable') return /--\s*\S/.test(line.slice(line.indexOf('eslint-disable')));
  if (marker === 'biome-ignore') return /biome-ignore\s+\S+\s*:\s*\S/.test(line);
  return false;
}

function matchMarker(line: string, file: string): string | null {
  const ext = fileExt(file);
  for (const { marker, re, exts } of MARKERS) {
    if (!exts.has(ext)) continue;
    const comment = commentPart(line, exts === JS_EXT);
    if (comment === null) continue;
    // Strip the opener so the start-anchored directive regexes see the
    // comment TEXT (`// @ts-ignore` → ` @ts-ignore`); Python regexes carry
    // their own `#` anchor and test the raw comment.
    const text = exts === JS_EXT ? comment.replace(/^(?:\/\/+|\/\*+)/, '') : comment;
    if (re.test(text)) return marker;
  }
  return null;
}

/**
 * Scan unified diff text for suppression markers on added lines (A1, A2).
 * Pure: input diff text, output findings — no git, no filesystem.
 */
export function scanDisableComments(diffText: string): SuppressionFinding[] {
  const lines = diffText.split('\n');

  // First pass: collect removed-line content so moves don't count (A1).
  const removed = new Set<string>();
  for (const l of lines) {
    if (l.startsWith('-') && !l.startsWith('---')) removed.add(l.slice(1).trim());
  }

  const findings: SuppressionFinding[] = [];
  let file: string | null = null;
  let newLine = 0; // 1-indexed line number in the new file for the NEXT line
  for (const l of lines) {
    if (l.startsWith('+++ ')) {
      const p = l.slice(4).trim();
      file = p === '/dev/null' ? null : p.replace(/^b\//, '');
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(l);
    if (hunk) {
      newLine = parseInt(hunk[1] ?? '0', 10);
      continue;
    }
    if (l.startsWith('-') && !l.startsWith('---')) continue; // old-file only
    if (l.startsWith('+')) {
      const content = l.slice(1);
      const marker = file ? matchMarker(content, file) : null;
      if (marker && file && !removed.has(content.trim())) {
        findings.push({
          file,
          line: newLine,
          marker,
          justified: isJustified(marker, content),
          text: content.trim(),
        });
      }
      newLine++;
      continue;
    }
    // Context line (or anything else inside a hunk body) advances the counter
    // only when we're inside a hunk; headers between hunks reset it anyway.
    if (newLine > 0 && !l.startsWith('diff ') && !l.startsWith('--- ')) newLine++;
  }
  return findings;
}

/** Render a finding as one gate-report line. */
export function formatSuppressionFinding(f: SuppressionFinding): string {
  return `${f.file}:${f.line} introduces ${f.marker}${f.justified ? ' (justified)' : ''} — ${f.text}`;
}
