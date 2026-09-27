/**
 * Test-title spec links (REQ-VSTATE-002).
 *
 * The repo convention is already `it('does X (REQ-FOO-001.A1)', …)`. That title
 * is the most precise test evidence a spec can have — it names the criterion the
 * test case proves — but nothing read it, so evidence had to be re-declared as a
 * `verifies:` block or an `@verifies` comment on a hoisted named function, and a
 * fixture file could satisfy the evidence gate by accident.
 *
 * This module turns those titles into `tests`-kind link candidates:
 *
 *   - Only TEST FILES are scanned (`__tests__/`, `*.test.*`, `*.spec.*`,
 *     `*_test.*`) — a spec id inside a source file's message string must never
 *     become test evidence (REQ-VSTATE-002.A2).
 *   - A candidate is file-derived: it is re-discovered from the file on every
 *     extraction pass, so it survives re-index (A3).
 *
 * TARGET CHOICE: the graph has no node for an `it(...)` call — extractors emit
 * nodes for declarations, not for call expressions — so a link that targeted the
 * test case itself would never resolve and would rest at `orphaned`. The link
 * therefore targets the test FILE's `file` node (always present, always
 * resolvable) and carries the matched test titles in `metadata.testTitles`. That
 * is the per-test-case granularity report ingestion needs (REQ-VSTATE-004 maps a
 * reported case to a link by file + title) without inventing node kinds.
 */

import type { SpecLinkKind } from '../types';

/** A spec id found inside an `it()` / `test()` title in a test file. */
export interface TestTitleRef {
  specId: string;
  /** The test title exactly as written (without quotes). */
  title: string;
  /** 1-indexed line of the `it()` / `test()` call. */
  line: number;
}

/**
 * `it(` / `test(` / `bench(` with the usual modifier chains
 * (`it.each`, `test.skip`, `it.runIf(...)`, `it.concurrent.only`) followed by a
 * quoted title. Group 2 is the quote char, group 3 the raw title body.
 */
const TEST_CALL =
  /\b(?:it|test|bench)((?:\.\w+)*(?:\([^()]*\))?(?:\.\w+)*)?\s*\(\s*(['"`])((?:\\.|(?!\2)[^\\])*)\2/g;

/**
 * A spec id as embedded in a test title: an upper-case dashed token
 * (`REQ-VSTATE-001`, `VSTATE-DOC`, `DOM-AUTH-003`) with an optional `.A<N>`
 * acceptance suffix. Deliberately loose — every hit is checked against the specs
 * table before a link is created, so a false positive costs nothing.
 */
const SPEC_ID_IN_TITLE = /\b([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+(?:\.A\d+)?)\b/g;

/**
 * True when `filePath` is a recognized test file (REQ-VSTATE-002.A4): it lives
 * under a `__tests__/` (or `tests/`, `spec/`) directory, or its basename carries
 * a `.test.` / `.spec.` / `_test.` marker.
 *
 * This is the SAME predicate the evidence gate uses, so "what counts as a test"
 * can't disagree between the two sides.
 */
export function isRecognizedTestFile(filePath: string): boolean {
  const p = filePath.replace(/\\/g, '/');
  const base = p.split('/').pop() ?? '';
  if (/(^|\/)(__tests__|__test__|tests|spec)(\/|$)/.test(p)) return true;
  if (/\.(test|spec)\.[^.]+$/.test(base)) return true;
  if (/_test\.[^.]+$/.test(base)) return true;
  if (/(^|[^A-Za-z])test_[^/]*\.py$/.test(base)) return true;
  return false;
}

/**
 * True when a `tests`-kind link points at something that is NOT in a recognized
 * test file, or was flagged as such when it was recorded (REQ-VSTATE-002.A4).
 * A fixture, a helper, or a source symbol can be *declared* as evidence, but it
 * must not satisfy the promotion gate.
 */
export function isNonTestEvidence(link: {
  kind: SpecLinkKind;
  targetFilePath: string;
  metadata?: Record<string, unknown>;
}): boolean {
  if (link.kind !== 'tests') return false;
  if (link.metadata?.nonTestTarget === true) return true;
  return !isRecognizedTestFile(link.targetFilePath);
}

/**
 * Every spec id mentioned in an `it()` / `test()` title in `source`.
 *
 * Returns one entry per (spec id, title) pair — a title naming two criteria
 * yields two refs, and the same criterion in two titles yields two refs.
 */
export function scanTestTitleRefs(source: string): TestTitleRef[] {
  const out: TestTitleRef[] = [];
  TEST_CALL.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TEST_CALL.exec(source)) !== null) {
    const title = m[3];
    if (title === undefined || title.length === 0) continue;
    // Template literals with `${}` interpolation are not stable evidence keys —
    // the report carries the interpolated text, which we can't reconstruct.
    if (m[2] === '`' && title.includes('${')) continue;
    const line = source.slice(0, m.index).split('\n').length;
    SPEC_ID_IN_TITLE.lastIndex = 0;
    let idMatch: RegExpExecArray | null;
    while ((idMatch = SPEC_ID_IN_TITLE.exec(title)) !== null) {
      const specId = idMatch[1];
      if (specId === undefined) continue;
      out.push({ specId, title, line });
    }
  }
  return out;
}
