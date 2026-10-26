import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { geminiTarget } from '../src/installer/targets/gemini';

/**
 * THROUGHPUT-DOC REQ-THRU-012 — "promise only what you can prove": user-facing
 * docs may not claim Gemini CLI retrieval parity with Claude Code until a
 * Gemini agent-eval results file exists in the repo. The 1-call / zero-Read
 * bar was measured on Claude Code only (scripts/agent-eval/CLAUDE.md).
 */

const ROOT = path.join(__dirname, '..');
/** Where a maintainer records a Gemini agent-eval run (REQ-LOWEND-005 harness). */
export const GEMINI_EVAL_RESULTS = 'docs/benchmarks/gemini-agent-eval.md';

/** Phrasings that assert Gemini performs like Claude Code. */
const PARITY_CLAIM =
  /gemini[^.\n]{0,80}\b(parity|as well as claude|on par|matches claude|same (retrieval|results|performance))\b|\b(parity|on par)\b[^.\n]{0,60}gemini/i;

function userFacingDocs(): string[] {
  const out = [path.join(ROOT, 'README.md')];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.mdx?$/.test(e.name)) out.push(p);
    }
  };
  const site = path.join(ROOT, 'site', 'src', 'content', 'docs');
  if (fs.existsSync(site)) walk(site);
  return out;
}

export function findGeminiParityClaims(files: string[]): string[] {
  const hits: string[] = [];
  for (const f of files) {
    fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (PARITY_CLAIM.test(line)) hits.push(`${path.relative(ROOT, f)}:${i + 1}: ${line.trim().slice(0, 160)}`);
    });
  }
  return hits;
}

function noGeminiParityClaimWithoutResults(): void {
  const hasResults = fs.existsSync(path.join(ROOT, GEMINI_EVAL_RESULTS));
  if (!hasResults) {
    expect(findGeminiParityClaims(userFacingDocs())).toEqual([]);
  }
  // The detector itself fires on a parity claim and stays quiet on a plain mention.
  const tmp = path.join(require('os').tmpdir(), `claims-${process.pid}.md`);
  fs.writeFileSync(tmp, 'SpecShip on Gemini CLI has retrieval parity with Claude Code.\nInstall with --target gemini.\n');
  try {
    expect(findGeminiParityClaims([tmp])).toHaveLength(1);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}


/** Docs that carry the Claude-vs-Gemini capability matrix (REQ-GEMINI-006.A3). */
export const CAPABILITY_MATRIX_DOCS = ['README.md', 'site/src/content/docs/guides/gemini-cli.md'];

const norm = (t: string) => t.toLowerCase().replace(/`/g, '').replace(/-/g, ' ').replace(/\s+/g, ' ').trim();

/** The matrix rows between the markers, as `{ surface, gemini }` cells. */
export function capabilityMatrixRows(markdown: string): Array<{ surface: string; gemini: string }> {
  const start = markdown.indexOf('<!-- capability-matrix:start -->');
  const end = markdown.indexOf('<!-- capability-matrix:end -->');
  if (start === -1 || end === -1) return [];
  return markdown
    .slice(start, end)
    .split('\n')
    .filter((l) => l.startsWith('|') && !/^\|[\s|-]*\|$/.test(l.trim()))
    .map((l) => l.split('|').slice(1, -1).map((c) => c.trim()))
    .filter((cells) => cells[0] !== '')
    .map((cells) => ({ surface: cells[0]!, gemini: cells[2] ?? '' }));
}

/** The surfaces the installer's capability note says a Gemini install lacks ("No X and no Y"). */
export function unsupportedSurfacesInNote(note: string): string[] {
  // The note's one "No X and no Y — …" sentence lists them.
  const m = note.match(/\bNo ([^—.]+?)\s+—/);
  return m ? m[1]!.split(/\s+and no\s+/i).map(norm) : [];
}

function capabilityMatrixMatchesTheInstaller(): void {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-home-'));
  const prev = { h: process.env.HOME, u: process.env.USERPROFILE };
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  let notes: string[];
  try {
    notes = geminiTarget.install('global', { autoAllow: true }).notes ?? [];
  } finally {
    if (prev.h === undefined) delete process.env.HOME;
    else process.env.HOME = prev.h;
    if (prev.u === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = prev.u;
    fs.rmSync(home, { recursive: true, force: true });
  }
  const note = notes.find((n) => /no equivalent surface/.test(n));
  expect(note, 'the Gemini install prints its capability note').toBeTruthy();
  const lacking = unsupportedSurfacesInNote(note!).sort();
  expect(lacking).toEqual(['specship explorer subagent', 'status line']);

  for (const doc of CAPABILITY_MATRIX_DOCS) {
    const rows = capabilityMatrixRows(fs.readFileSync(path.join(ROOT, doc), 'utf8'));
    expect(rows.length, `${doc} carries the capability matrix`).toBeGreaterThan(5);
    // A row marked unsupported for Gemini is exactly a surface the installer names as missing,
    // and nothing the installer names as missing is shown as supported.
    const unsupported = rows.filter((r) => r.gemini.startsWith('—')).map((r) => norm(r.surface).replace(/ segment$/, ''));
    expect(unsupported.sort(), `${doc} unsupported rows`).toEqual(lacking);
  }
}

describe('docs claims (REQ-THRU-012)', () => {
  it('docs make no Gemini parity claim without eval results (REQ-THRU-012.A1)', noGeminiParityClaimWithoutResults);
  it('docs carry the Claude-vs-Gemini matrix, matching what the installer reports (REQ-GEMINI-006.A3)', capabilityMatrixMatchesTheInstaller);
});
