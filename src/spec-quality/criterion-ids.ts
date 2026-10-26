/**
 * Spec ids named in free text, with criterion shorthand expanded
 * (PIPETRUST-DOC, REQ-PIPETRUST-008).
 *
 * Test titles cite several criteria of one requirement in shorthand —
 * `REQ-X-004.A1/A3`, `REQ-X-028.A2/.A3`, `REQ-X-001.A1 / A3`. Reading only the
 * first id left the rest silently unlinked, so the title scanner and postcheck
 * share this one parser. A bare `A2` with no preceding full id names nothing,
 * and ids match whole: `REQ-X.A10` never yields `REQ-X.A1`.
 */

/** A full spec id, an optional `.A<N>` suffix, then any `/A<N>`, `, .A<N>`, `& A<N>` continuations. */
const SPEC_ID_CHAIN =
  /\b([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+)(\.A\d+)?((?:\s*[/,&]\s*\.?A\d+\b)*)(?![\w-])/g;
const CONTINUATION = /\.?A(\d+)/g;

/** Every spec id `text` names, shorthand expanded, in order of appearance (duplicates kept). */
export function criterionIdsInText(text: string): string[] {
  const out: string[] = [];
  SPEC_ID_CHAIN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SPEC_ID_CHAIN.exec(text)) !== null) {
    const base = m[1]!;
    const first = m[2];
    if (!first) {
      out.push(base);
      continue;
    }
    out.push(base + first);
    const chain = m[3] ?? '';
    CONTINUATION.lastIndex = 0;
    let c: RegExpExecArray | null;
    while ((c = CONTINUATION.exec(chain)) !== null) out.push(`${base}.A${c[1]}`);
  }
  return out;
}
