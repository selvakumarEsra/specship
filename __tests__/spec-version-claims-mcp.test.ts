/**
 * `specship_spec`'s Version claims section (REQ-LINKACC-008): the owning
 * document's `checked_against` claims, checked with the same resolver and
 * wording as `specship lint`.
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { renderVersionClaims } from '../src/mcp/spec-tools';
import { clearVersionProbeCache } from '../src/spec-lint/version-claims';
import type { Spec } from '../src/types';
import type { SpecQueries } from '../src/db/spec-queries';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true });
});

function project(version: string | null): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'specship-vclaim-'));
  dirs.push(dir);
  if (version) {
    const p = path.join(dir, 'node_modules', '@google', 'gemini-cli');
    fs.mkdirSync(p, { recursive: true });
    fs.writeFileSync(path.join(p, 'package.json'), JSON.stringify({ version }));
  }
  return dir;
}

const doc = { id: 'X-DOC', kind: 'document', metadata: { checked_against: '@google/gemini-cli@0.28.0' } } as unknown as Spec;
const req = { id: 'REQ-X-001', kind: 'requirement', parentId: 'X-DOC' } as unknown as Spec;
const sq = { getSpecById: (id: string) => (id === 'X-DOC' ? doc : null) } as unknown as SpecQueries;

function specToolShowsStaleClaimOfParentDocument() {
  clearVersionProbeCache();
  const out = renderVersionClaims(sq, req, project('0.67.0')).join('\n');
  expect(out).toContain('## Version claims');
  expect(out).toContain('STALE');
  expect(out).toContain('checked against @google/gemini-cli 0.28.0, project uses 0.67.0');
}

function specToolHidesCurrentClaim() {
  clearVersionProbeCache();
  expect(renderVersionClaims(sq, req, project('0.28.0'))).toEqual([]);
}

function specToolShowsUncheckedNeverCurrent() {
  clearVersionProbeCache();
  const out = renderVersionClaims(sq, req, project(null)).join('\n');
  expect(out).toContain('unchecked');
  expect(out.toLowerCase()).not.toContain('current');
}

describe('specship_spec — version claims (REQ-LINKACC-008)', () => {
  it('shows a stale claim from the requirement\'s document, naming both versions (REQ-LINKACC-008)', specToolShowsStaleClaimOfParentDocument);
  it('shows nothing when the claimed version is in use (REQ-LINKACC-008)', specToolHidesCurrentClaim);
  it('shows an unresolvable claim as unchecked, never current (REQ-LINKACC-008)', specToolShowsUncheckedNeverCurrent);
});
