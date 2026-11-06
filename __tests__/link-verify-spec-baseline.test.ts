/**
 * REQ-LINKACC-013 — verifying a link takes a new spec-text baseline.
 *
 * End to end against a real temp project: a spec file, a code file and a test
 * file are indexed, the spec is edited and synced the way a developer would,
 * and each verify path (the `specship_link_verify` tool, the dashboard route's
 * instance call, a vitest JSON report) is driven for real.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import SpecShip from '../src';
import type { SpecLink, SpecLinkKind } from '../src/types';
import { handleSpecshipLinkVerify } from '../src/mcp/spec-tools';

const fts5Available = (() => {
  for (const probe of [
    () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Database = require('better-sqlite3');
      return new Database(':memory:');
    },
    () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { DatabaseSync } = require('node:sqlite');
      return new DatabaseSync(':memory:');
    },
  ]) {
    try {
      const db = probe();
      try {
        db.exec('CREATE VIRTUAL TABLE _probe USING fts5(x)');
        return true;
      } catch {
        /* no fts5 on this backend */
      } finally {
        db.close();
      }
    } catch {
      /* backend unavailable */
    }
  }
  return false;
})();

const CODE_V1 = `export function total(items: number[]): number {
  let sum = 0;
  for (const i of items) sum += i;
  return sum;
}
`;

/** Parameter renamed: the signature moves. */
const CODE_V2 = CODE_V1.replace(/items/g, 'values');

const TEST_FILE = `import { it } from 'vitest';
import { total } from '../src/total';

function checksTotal(): void {
  if (total([1, 2]) !== 3) throw new Error('bad');
}

it('checksTotal', checksTotal);
`;

function requirement(id: string, title: string, text: string, extra = ''): string {
  return `<!-- id: ${id} -->
## ${title}

${text}

implementations:
  - src/total.ts:total
${extra}`;
}

function specFile(texts: { one: string; two: string; three: string; four: string }): string {
  const verifies = `
verifies:
  - __tests__/total.test.ts:checksTotal
`;
  return `---
id: TB-DOC
title: Baseline fixture
---

<!-- id: TB-DOC -->
# Baseline fixture

${requirement('REQ-TB-001', 'Total MUST add numbers', texts.one, verifies)}
${requirement('REQ-TB-002', 'Total MUST start at zero', texts.two, verifies)}
${requirement('REQ-TB-003', 'Total MUST accept an empty list', texts.three, verifies)}
${requirement('REQ-TB-004', 'Total MUST be proven by a test', texts.four, verifies)}
`;
}

const BASE = {
  one: 'The total function MUST add every number it is given.',
  two: 'The total function MUST start counting at zero.',
  three: 'The total function MUST return zero for an empty list.',
  four: 'The total function MUST have a passing test.',
};

describe.skipIf(!fts5Available)('verifying a link takes a new spec-text baseline (REQ-LINKACC-013)', () => {
  let dir: string;
  let cg: SpecShip;
  let texts: typeof BASE;

  const write = (rel: string, body: string): void => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body, 'utf-8');
  };
  const editSpec = async (patch: Partial<typeof BASE>): Promise<void> => {
    texts = { ...texts, ...patch };
    write('specs/baseline.md', specFile(texts));
    await cg.sync();
  };
  const link = (specId: string, kind: SpecLinkKind = 'implements'): SpecLink => {
    const found = cg.getSpecQueries().getLinksBySpec(specId).find((l) => l.kind === kind);
    if (!found) throw new Error(`no ${kind} link on ${specId}`);
    return found;
  };
  const specHash = (specId: string): string => cg.getSpecQueries().getSpecById(specId)!.contentHash;
  const signature = (l: SpecLink): string | undefined =>
    cg.getSpecLinkResolver().findLogicalTarget(l.targetFilePath, l.targetQualifiedName, l.targetNodeKind)?.signature;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-linkacc013-'));
    texts = { ...BASE };
    write('src/total.ts', CODE_V1);
    write('__tests__/total.test.ts', TEST_FILE);
    write('specs/baseline.md', specFile(texts));
    cg = await SpecShip.init(dir);
    await cg.indexAll();
  });

  afterEach(() => {
    cg?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /**
   * A verified link whose requirement's text then changed: the sticky verdict
   * keeps the old stored hash, and the sync drifts the link on the spec side.
   */
  async function staleRequirementText(): Promise<string> {
    await verifyPass('REQ-TB-001');
    const before = link('REQ-TB-001').specHashAtLink;
    await editSpec({ one: 'The total function MUST add every number it is given, in order.' });
    expect(specHash('REQ-TB-001')).not.toBe(before);
    expect(link('REQ-TB-001').state).toBe('drifted');
    expect(link('REQ-TB-001').driftAxis).toBe('spec');
    return before;
  }

  async function verifyPass(specId: string): Promise<void> {
    const res = await handleSpecshipLinkVerify(cg, { link_id: link(specId).id, result: 'pass', reason: 'reviewed' });
    expect(res.isError).toBeFalsy();
  }

  async function reqLinkacc013A1(): Promise<void> {
    await staleRequirementText();
    await verifyPass('REQ-TB-001');
    expect(link('REQ-TB-001').specHashAtLink).toBe(specHash('REQ-TB-001'));

    // The spec file syncs again (another requirement moved); REQ-TB-001's text did not.
    await editSpec({ two: 'The total function MUST start counting at exactly zero.' });
    const after = link('REQ-TB-001');
    expect(after.state).toBe('verified');
    expect(after.specHashAtLink).toBe(specHash('REQ-TB-001'));
  }

  async function reqLinkacc013A2(): Promise<void> {
    await staleRequirementText();
    await verifyPass('REQ-TB-001');
    await editSpec({ three: 'The total function MUST return 0 for an empty list.' });
    await editSpec({ four: 'The total function MUST have at least one passing test.' });
    const after = link('REQ-TB-001');
    expect(after.state).toBe('verified');
    expect(after.driftAxis).toBeNull();
  }

  async function reqLinkacc013A3(): Promise<void> {
    await staleRequirementText();
    await verifyPass('REQ-TB-001');
    await editSpec({ one: 'The total function MUST add every number it is given, left to right.' });
    const after = link('REQ-TB-001');
    expect(after.state).toBe('drifted');
    expect(after.driftAxis).toBe('spec');
  }

  async function reqLinkacc013A4(): Promise<void> {
    // Three links verified under the original text (setup, not a path under test)...
    const sq = cg.getSpecQueries();
    for (const l of [link('REQ-TB-001'), link('REQ-TB-003'), link('REQ-TB-004', 'tests')]) {
      sq.updateSpecLinkState(l.id, 'verified', null);
    }
    // ...then every baseline goes stale: the requirements' text and the code signature.
    await editSpec({
      one: `${BASE.one} Edited.`,
      three: `${BASE.three} Edited.`,
      four: `${BASE.four} Edited.`,
    });
    write('src/total.ts', CODE_V2);
    await cg.sync();
    const sigNow = signature(link('REQ-TB-001'));
    expect(sigNow).toBeTruthy();
    expect(link('REQ-TB-001').nodeSigAtLink).not.toBe(sigNow);

    // 1. The MCP tool.
    await verifyPass('REQ-TB-001');
    // 2. The dashboard verify route's call (POST /api/spec/link-verify calls this on a pass).
    const dash = link('REQ-TB-003');
    const metadata: Record<string, unknown> = { ...(dash.metadata ?? {}) };
    cg.rebaselineLinkOnVerify(dash, metadata);
    cg.getSpecQueries().updateSpecLinkMetadata(dash.id, metadata);
    // 3. A passing vitest report promoting REQ-TB-004's tests link.
    const testLink = link('REQ-TB-004', 'tests');
    const testSigNow = signature(testLink);
    fs.writeFileSync(path.join(dir, 'report.json'), report(dir, 'passed'), 'utf-8');
    const result = cg.verifyFromReport('report.json');
    expect(result.promoted.map((p) => p.specId)).toContain('REQ-TB-004');

    for (const id of ['REQ-TB-001', 'REQ-TB-003']) {
      const l = link(id);
      expect(l.specHashAtLink).toBe(specHash(id));
      expect(l.nodeSigAtLink).toBe(sigNow);
    }
    const t = link('REQ-TB-004', 'tests');
    expect(t.state).toBe('verified');
    expect(t.specHashAtLink).toBe(specHash('REQ-TB-004'));
    if (testSigNow) expect(t.nodeSigAtLink).toBe(testSigNow);
  }

  async function reqLinkacc013A5(): Promise<void> {
    // Both links verified under the original text: the implements link by the
    // tool, the tests link by a passing report...
    await verifyPass('REQ-TB-001');
    fs.writeFileSync(path.join(dir, 'report.json'), report(dir, 'passed'), 'utf-8');
    cg.verifyFromReport('report.json');
    expect(link('REQ-TB-004', 'tests').state).toBe('verified');
    // ...then both requirements' text and the code signature move in one sync each.
    await editSpec({ one: `${BASE.one} Edited.`, four: `${BASE.four} Edited.` });
    write('src/total.ts', CODE_V2);
    await cg.sync();
    const oldHash = link('REQ-TB-001').specHashAtLink;
    const oldSig = link('REQ-TB-001').nodeSigAtLink;
    const oldTestHash = link('REQ-TB-004', 'tests').specHashAtLink;
    expect(oldHash).not.toBe(specHash('REQ-TB-001'));
    expect(oldTestHash).not.toBe(specHash('REQ-TB-004'));
    expect(signature(link('REQ-TB-001'))).not.toBe(oldSig);

    const res = await handleSpecshipLinkVerify(cg, { link_id: link('REQ-TB-001').id, result: 'fail', reason: 'wrong' });
    expect(res.isError).toBeFalsy();
    const failed = link('REQ-TB-001');
    expect(failed.state).toBe('broken');
    expect(failed.specHashAtLink).toBe(oldHash);
    expect(failed.nodeSigAtLink).toBe(oldSig);

    const testBefore = link('REQ-TB-004', 'tests');
    fs.writeFileSync(path.join(dir, 'report.json'), report(dir, 'failed'), 'utf-8');
    const result = cg.verifyFromReport('report.json');
    expect(result.demoted.map((d) => d.specId)).toContain('REQ-TB-004');
    const t = link('REQ-TB-004', 'tests');
    expect(t.state).toBe('broken');
    expect(t.specHashAtLink).toBe(oldTestHash);
    expect(t.nodeSigAtLink).toBe(testBefore.nodeSigAtLink);
  }

  it('REQ-LINKACC-013.A1: a link verified after its requirement changed does not drift on the next sync', reqLinkacc013A1);
  it('REQ-LINKACC-013.A2: editing another requirement in the file does not drift a verified link', reqLinkacc013A2);
  it('REQ-LINKACC-013.A3: editing the linked requirement after verify still drifts the link on the spec side', reqLinkacc013A3);
  it('REQ-LINKACC-013.A4: the dashboard verify call and a passing report take the same baseline as the tool', reqLinkacc013A4);
  it('REQ-LINKACC-013.A5: a failed verification leaves both stored baselines as they were', reqLinkacc013A5);
});

/** A vitest `--reporter=json` payload with the fixture's one test case. */
function report(root: string, status: 'passed' | 'failed'): string {
  return JSON.stringify({
    numTotalTests: 1,
    success: status === 'passed',
    testResults: [
      {
        name: path.join(root, '__tests__/total.test.ts'),
        status,
        assertionResults: [
          {
            ancestorTitles: [],
            title: 'checksTotal',
            fullName: 'checksTotal',
            status,
            failureMessages: status === 'failed' ? ['Error: bad'] : [],
          },
        ],
      },
    ],
  });
}
