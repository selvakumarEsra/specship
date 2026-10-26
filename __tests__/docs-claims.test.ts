import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

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

describe('docs claims (REQ-THRU-012)', () => {
  it('docs make no Gemini parity claim without eval results (REQ-THRU-012.A1)', noGeminiParityClaimWithoutResults);
});
