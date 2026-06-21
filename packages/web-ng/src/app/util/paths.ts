/**
 * Path-label helper for treemaps / file lists.
 *
 * The design's mock data uses short relative paths (`src/auth.ts`), but real
 * Claude Code transcripts record whatever the tool was given — usually an
 * ABSOLUTE path, and often spanning several projects (the claude_* tables are
 * cross-project). `path.replace('src/','')` can't shorten those, so a treemap
 * renders unreadable full-path labels that all truncate to the same shared
 * prefix. `shortLabel` keeps the trailing `count` segments (`parent/file.ts`) —
 * the distinguishing tail, which is what reads best in a narrow cell and
 * matches the `parent/file` shape the design's short labels take.
 */
export function shortLabel(p: string, count = 2): string {
  const segs = p.split('/').filter(Boolean);
  return segs.slice(-count).join('/') || p;
}
