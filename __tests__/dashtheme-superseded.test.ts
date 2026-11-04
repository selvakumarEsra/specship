/**
 * REQ-DASHTHEME-005 — the visual requirements DASHTHEME-DOC replaces carry a
 * dated SUPERSEDED note naming their replacement, and the spec set still
 * lints clean.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { lintSpecs } from '../src/spec-lint/lint';

const repoRoot = path.resolve(__dirname, '..');
const read = (rel: string): string => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

/** The text of one requirement: from its id marker to the next REQ marker. */
function sectionOf(source: string, id: string): string {
  const marker = `<!-- id: ${id} -->`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`missing ${marker}`);
  const rest = source.slice(start + marker.length);
  const next = rest.search(/<!-- id: REQ-[A-Z0-9-]+ -->/);
  return next < 0 ? rest : rest.slice(0, next);
}

const SUPERSEDED = /^> \*\*SUPERSEDED \d{4}-\d{2}-\d{2}[^*]*\*\* by (.+)$/gm;

/** Every dated SUPERSEDED blockquote line in a section. */
function supersededNotes(section: string): string[] {
  return [...section.matchAll(SUPERSEDED)].map((m) => m[0]);
}

function reqDashtheme005A1(): void {
  const section = sectionOf(read('specs/lean-dashboard.md'), 'REQ-DASHLEAN-005');
  const notes = supersededNotes(section);
  expect(notes.some((n) => n.includes('DASHTHEME-DOC'))).toBe(true);
}

function reqDashtheme005A2(): void {
  const src = read('specs/specship-desktop.md');

  const d018 = supersededNotes(sectionOf(src, 'REQ-DESKTOP-018'));
  expect(d018.some((n) => n.includes('REQ-DASHSIMPLE-001'))).toBe(true);
  expect(
    d018.some((n) => n.includes('REQ-DASHTHEME-003') && /theme toggle/i.test(n) && /light theme/i.test(n)),
  ).toBe(true);

  const d028 = supersededNotes(sectionOf(src, 'REQ-DESKTOP-028'));
  expect(
    d028.some((n) => n.includes('REQ-DASHTHEME-003') && /theme/i.test(n) && /gallery/i.test(n) && /dark theme only/i.test(n)),
  ).toBe(true);

  const d014 = supersededNotes(sectionOf(src, 'REQ-DESKTOP-014'));
  expect(
    d014.some((n) => n.includes('REQ-DASHTHEME-003') && /light theme/i.test(n) && /dark theme only/i.test(n)),
  ).toBe(true);
}

function reqDashtheme005A3(): void {
  const report = lintSpecs(['specs'], { projectRoot: repoRoot });
  const errors = report.files.flatMap((f) => f.findings.filter((x) => x.severity === 'error'));
  expect(errors).toEqual([]);
  expect(report.hasErrors).toBe(false);
}

describe('REQ-DASHTHEME-005 superseded visual requirements are marked', () => {
  it('REQ-DASHTHEME-005.A1: lean-dashboard marks REQ-DASHLEAN-005 superseded by DASHTHEME-DOC', reqDashtheme005A1);
  it('REQ-DASHTHEME-005.A2: specship-desktop marks the theme parts of REQ-DESKTOP-014/018/028 superseded by REQ-DASHTHEME-003', reqDashtheme005A2);
  it('REQ-DASHTHEME-005.A3: specship lint specs reports no errors', reqDashtheme005A3);
});
