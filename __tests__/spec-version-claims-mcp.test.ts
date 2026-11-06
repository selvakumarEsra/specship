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
import { checkVersionClaims, clearVersionProbeCache, parseVersionClaims, versionProbeCachePath } from '../src/spec-lint/version-claims';
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

/** A project whose only source for the version is a configured probe that leaves a marker when it runs. */
function probedProject(): { dir: string; marker: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'specship-vprobe-'));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, '.specship'));
  const marker = path.join(dir, 'probe-ran');
  // No shell: splitCommand groups quotes and never interprets backslashes.
  const command = `${process.execPath} -e "require('fs').writeFileSync('${marker}', 'x'); console.log('gemini 0.67.0')"`;
  fs.writeFileSync(path.join(dir, 'specship.config.json'), JSON.stringify({ versionProbes: { '@google/gemini-cli': command } }));
  return { dir, marker };
}

// A retrieval call never waits on a process: specship_spec reads the result
// lint saved and never runs the probe itself.
function specToolNeverRunsAProbe() {
  clearVersionProbeCache();
  const { dir, marker } = probedProject();
  const out = renderVersionClaims(sq, req, dir).join('\n');
  expect(fs.existsSync(marker)).toBe(false);
  expect(out).toContain('unchecked'); // lint has not probed yet
}

function specToolShowsTheResultLintSaved() {
  clearVersionProbeCache();
  const { dir, marker } = probedProject();
  // lint's path runs the probe and saves the result …
  const linted = checkVersionClaims(doc.metadata as Record<string, unknown>, dir);
  expect(linted[0]).toMatchObject({ status: 'stale', inUse: '0.67.0' });
  expect(fs.existsSync(marker)).toBe(true);
  expect(fs.existsSync(versionProbeCachePath(dir))).toBe(true);
  // … and specship_spec shows it without running anything.
  fs.rmSync(marker);
  clearVersionProbeCache();
  const out = renderVersionClaims(sq, req, dir).join('\n');
  expect(out).toContain('checked against @google/gemini-cli 0.28.0, project uses 0.67.0');
  expect(fs.existsSync(marker)).toBe(false);
}

function parseHandlesListsAndBadValues() {
  const many = parseVersionClaims({ checked_against: '@google/gemini-cli@0.28.0, typescript@5.4.0' });
  expect(many.errors).toEqual([]);
  expect(many.claims.map((c) => `${c.pkg}@${c.version}`)).toEqual(['@google/gemini-cli@0.28.0', 'typescript@5.4.0']);
  for (const bad of [123, '', ' , ', '@', 'gemini-cli@', '@0.28.0']) {
    const r = parseVersionClaims({ checked_against: bad as unknown as string });
    expect(r.claims, `value ${JSON.stringify(bad)}`).toEqual([]);
    expect(r.errors.length, `value ${JSON.stringify(bad)}`).toBeGreaterThan(0);
  }
  expect(parseVersionClaims({})).toEqual({ claims: [], errors: [] });
}

describe('specship_spec — version claims (REQ-LINKACC-008)', () => {
  it('REQ-LINKACC-008.A3: specship_spec never runs a probe; with no saved result the claim is unchecked', specToolNeverRunsAProbe);
  it('REQ-LINKACC-008.A1: specship_spec shows the probe result lint saved, naming both versions', specToolShowsTheResultLintSaved);
  it('REQ-LINKACC-008.A4: a list of claims parses; a number, empty value or missing package/version is malformed', parseHandlesListsAndBadValues);
  it('shows a stale claim from the requirement\'s document, naming both versions (REQ-LINKACC-008)', specToolShowsStaleClaimOfParentDocument);
  it('shows nothing when the claimed version is in use (REQ-LINKACC-008)', specToolHidesCurrentClaim);
  it('shows an unresolvable claim as unchecked, never current (REQ-LINKACC-008)', specToolShowsUncheckedNeverCurrent);
});
