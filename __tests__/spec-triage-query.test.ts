/**
 * `specship_spec` query mode (REQ-TRIAGE-001): a free-text `query` returns
 * scored, ranked specs over the spec FTS index, each with id / title / kind /
 * score / snippet (A1). The existing funnel (no arg) and detail (spec_id) modes
 * are unchanged (A2), and a query against an empty / spec-less index returns an
 * explicit "no specs to search" result, not an error (A3).
 *
 * Skipped where the system SQLite lacks FTS5 (same pattern as the resolver suite).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import SpecShip from '../src';
import { handleSpecshipSpec } from '../src/mcp/spec-tools';
import { Spec } from '../src/types';

const fts5Available = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require('better-sqlite3');
    const db = new Database(':memory:');
    try {
      db.exec('CREATE VIRTUAL TABLE _probe USING fts5(x)');
      db.close();
      return true;
    } catch {
      db.close();
    }
  } catch {
    /* fall through */
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(':memory:');
    try {
      db.exec('CREATE VIRTUAL TABLE _probe USING fts5(x)');
      db.close();
      return true;
    } catch {
      db.close();
    }
  } catch {
    /* not available */
  }
  return false;
})();

function textOf(result: { content: Array<{ text: string }> }): string {
  return result.content.map((c) => c.text).join('\n');
}

describe.skipIf(!fts5Available)('specship_spec — query mode (REQ-TRIAGE-001)', () => {
  let dir: string;
  let cg: SpecShip;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-spec-triage-'));
    cg = await SpecShip.init(dir);
  });
  afterEach(async () => {
    cg?.close();
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  });

  function insertSpec(partial: Partial<Spec> & Pick<Spec, 'id' | 'title' | 'body'>): void {
    const now = Date.now();
    cg.getSpecQueries().insertSpec({
      kind: 'requirement',
      format: 'markdown',
      sourcePath: 'specs/auth.md',
      contentHash: partial.id,
      createdAt: now,
      updatedAt: now,
      ...partial,
    });
  }

  function seedAuthAndBilling(): void {
    insertSpec({
      id: 'REQ-AUTH-001',
      title: 'Users MUST authenticate with a password',
      body: 'Login flow validates the password against a stored hash and issues a session token.',
    });
    insertSpec({
      id: 'REQ-AUTH-002',
      title: 'Sessions MUST expire after inactivity',
      body: 'A session token is invalidated after a period of inactivity, forcing re-login.',
    });
    insertSpec({
      id: 'REQ-BILL-001',
      kind: 'requirement',
      title: 'Invoices MUST be generated monthly',
      sourcePath: 'specs/billing.md',
      body: 'A recurring job produces an invoice for each active subscription at the start of each month.',
    });
  }

  // ---- A1: query returns scored, ranked specs with id/title/kind/score/snippet

  it('returns ranked candidates with id, title, kind, score and snippet (A1)', async () => {
    seedAuthAndBilling();
    const result = await handleSpecshipSpec(cg, { query: 'password login' });
    expect(result.isError).toBeFalsy();
    const out = textOf(result);

    // The auth specs match; the billing spec does not surface for these terms.
    expect(out).toContain('REQ-AUTH-001');
    expect(out).toContain('Users MUST authenticate with a password');
    expect(out).not.toContain('REQ-BILL-001');

    // Carries kind + a numeric score so the agent can act without a follow-up fetch.
    expect(out).toContain('kind: requirement');
    expect(out).toMatch(/score: \d+\.\d{2}/);
  });

  it('ranks the stronger title/body match first', async () => {
    seedAuthAndBilling();
    const result = await handleSpecshipSpec(cg, { query: 'password' });
    const out = textOf(result);
    // REQ-AUTH-001 (title + body mention "password") should appear before
    // REQ-AUTH-002 (which does not mention it at all).
    const idxOne = out.indexOf('REQ-AUTH-001');
    const idxTwo = out.indexOf('REQ-AUTH-002');
    expect(idxOne).toBeGreaterThanOrEqual(0);
    if (idxTwo >= 0) expect(idxOne).toBeLessThan(idxTwo);
  });

  it('returns a clear no-match note when nothing matches (index is non-empty)', async () => {
    seedAuthAndBilling();
    const result = await handleSpecshipSpec(cg, { query: 'kubernetes helm chart' });
    expect(result.isError).toBeFalsy();
    const out = textOf(result);
    expect(out).toContain('No matching specs');
    expect(out).not.toContain('No specs to search');
  });

  // ---- A2: existing modes unchanged

  it('leaves the no-arg funnel mode unchanged (A2)', async () => {
    seedAuthAndBilling();
    const out = textOf(await handleSpecshipSpec(cg, {}));
    expect(out).toContain('Spec lifecycle funnel');
  });

  it('leaves the spec_id detail mode unchanged (A2)', async () => {
    seedAuthAndBilling();
    const out = textOf(await handleSpecshipSpec(cg, { spec_id: 'REQ-AUTH-001' }));
    expect(out).toContain('# REQ-AUTH-001');
    expect(out).toContain('## Body');
  });

  it('an empty-string query falls through to the funnel, not search', async () => {
    seedAuthAndBilling();
    const out = textOf(await handleSpecshipSpec(cg, { query: '   ' }));
    expect(out).toContain('Spec lifecycle funnel');
  });

  it('rejects a non-string query', async () => {
    const result = await handleSpecshipSpec(cg, { query: 123 });
    expect(result.isError).toBeTruthy();
    expect(textOf(result)).toContain('query must be a string');
  });

  // ---- A3: empty index → explicit no-specs result, not an error

  it('reports "no specs to search" on an empty index, not an error (A3)', async () => {
    const result = await handleSpecshipSpec(cg, { query: 'anything at all' });
    expect(result.isError).toBeFalsy();
    const out = textOf(result);
    expect(out).toContain('No specs to search');
    expect(out).not.toContain('No matching specs');
  });

  // ---- searchSpecs primitive directly

  it('searchSpecs returns positive scores and a snippet from the body', () => {
    seedAuthAndBilling();
    const hits = cg.getSpecQueries().searchSpecs('invoice subscription');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].spec.id).toBe('REQ-BILL-001');
    expect(hits[0].score).toBeGreaterThan(0);
    expect(hits[0].snippet.length).toBeGreaterThan(0);
  });

  it('searchSpecs ignores FTS boolean operators / special chars without throwing', () => {
    seedAuthAndBilling();
    // Bare operators + punctuation must not produce a malformed MATCH expression.
    expect(() => cg.getSpecQueries().searchSpecs('AND OR NOT')).not.toThrow();
    expect(cg.getSpecQueries().searchSpecs('AND OR NOT')).toEqual([]);
    expect(() => cg.getSpecQueries().searchSpecs('password*()^"')).not.toThrow();
  });
});
