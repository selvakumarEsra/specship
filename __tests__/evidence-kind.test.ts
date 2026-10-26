/**
 * Evidence kinds (PIPETRUST-DOC — REQ-PIPETRUST-001/002/003).
 *
 * Required kind per criterion (declared tag or derived), test-file
 * classification, and kind-aware coverage with the `--require-kinds` gate.
 *
 * Coverage tests build a real index (SpecShip.init) and are skipped without
 * FTS5 in the system SQLite, like the existing spec-coverage suite.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import SpecShip from '../src';
import type { SpecLinkKind, NodeKind } from '../src/types';
import {
  parseDeclaredEvidenceKind,
  requiredEvidenceKind,
  classifyTestEvidence,
} from '../src/spec-quality/evidence-kind';
import { lintSpecSource } from '../src/spec-lint/lint';
import { criteriaMissingKind, requireKindsExitCode } from '../src/graph/spec-coverage';

const dirs: string[] = [];
function tempDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-evidence-kind-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  while (dirs.length) {
    const d = dirs.pop()!;
    if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
  }
});

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
    // fall through to node:sqlite
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
    // Node < 22.5
  }
  return false;
})();

// Fixture library names are assembled at runtime so this file itself does not
// classify as property/e2e evidence when SpecShip reads it.
const q = (s: string) => `'${s}'`;
const j = (...parts: string[]) => parts.join('');
const FAST_CHECK = q(j('fast', '-check'));
const PLAYWRIGHT = q(j('@playwright', '/test'));
const FC_BODY = j('f', 'c.assert(f', 'c.property(f', 'c.integer(), () => true));\n');
const HYPOTHESIS = j('from hypo', 'thesis import given\n@giv', 'en(st.integers())\ndef test_x(n): ...');
const SCHEMATHESIS = j('// run via schema', 'thesis against openapi.json');
const PACT = j("import { PactV3 } from '@pact", "-foundation/pact';");

function declaredKindWins(): void {
  expect(parseDeclaredEvidenceKind('Saving works (evidence: e2e)')).toEqual({ kind: 'e2e' });
  expect(parseDeclaredEvidenceKind('Saving works (Evidence: CONTRACT)')).toEqual({ kind: 'contract' });
  expect(parseDeclaredEvidenceKind('Saving works')).toEqual({});
  // Wording that would derive `property`, and links that would derive `contract`,
  // both lose to the declared tag.
  expect(
    requiredEvidenceKind('The total never goes negative (evidence: e2e)', { linksRoute: true, linksUi: false })
  ).toBe('e2e');
  // The tag documented inside backticks is not a declaration.
  expect(parseDeclaredEvidenceKind('A criterion carrying `(evidence: e2e)` resolves')).toEqual({});
}

function derivedKindFollowsCriterionShape(): void {
  expect(requiredEvidenceKind('The parser never throws on any input')).toBe('property');
  expect(requiredEvidenceKind('Clicking save shows a toast', { linksUi: true })).toBe('e2e');
  expect(requiredEvidenceKind('GET /users returns 200', { linksRoute: true })).toBe('contract');
  expect(requiredEvidenceKind('Returns the sum of two numbers')).toBe('unit');
  // Invariant phrasing outranks a UI link; UI outranks route.
  expect(requiredEvidenceKind('The list is always sorted', { linksUi: true })).toBe('property');
  expect(requiredEvidenceKind('Shows the page', { linksUi: true, linksRoute: true })).toBe('e2e');
  // An invalid declared kind falls back to derivation (the lint reports it).
  expect(requiredEvidenceKind('Returns the sum (evidence: smoke)')).toBe('unit');
}

function unknownDeclaredKindIsALintError(): void {
  const spec = (kind: string) => `---
id: EK-DOC
title: Evidence kinds
---

<!-- id: EK-DOC -->
# Evidence kinds

Non-goals: none. Test plan: unit tests.

<!-- id: REQ-EK-001 -->
## The thing MUST work

verifies:
  - __tests__/ek.test.ts:worksFn

## Acceptance
<!-- id: REQ-EK-001.A1 -->
- It fails with an error on bad input (evidence: ${kind}).
`;
  const bad = lintSpecSource('specs/ek.md', spec('smoke')).filter((f) => f.code === 'spec_unknown_evidence_kind');
  expect(bad).toHaveLength(1);
  expect(bad[0]!.severity).toBe('error');
  expect(bad[0]!.specId).toBe('REQ-EK-001.A1');
  expect(bad[0]!.message).toContain('smoke');

  for (const ok of ['unit', 'property', 'e2e', 'contract', 'E2E']) {
    expect(lintSpecSource('specs/ek.md', spec(ok)).some((f) => f.code === 'spec_unknown_evidence_kind')).toBe(false);
  }
}

function classifiesTestFilesByKind(): void {
  // From source.
  expect(classifyTestEvidence('__tests__/a.test.ts', `import fc from ${FAST_CHECK};\n`)).toBe('property');
  expect(classifyTestEvidence('tests/test_a.py', HYPOTHESIS)).toBe('property');
  expect(classifyTestEvidence('tests/login.spec.ts', `import { test } from ${PLAYWRIGHT};\n`)).toBe('e2e');
  expect(classifyTestEvidence('tests/api.test.ts', SCHEMATHESIS)).toBe('contract');
  expect(classifyTestEvidence('tests/api.test.ts', PACT)).toBe('contract');
  expect(classifyTestEvidence('tests/plain.test.ts', "import { it } from 'vitest';")).toBe('unit');
  // From path.
  expect(classifyTestEvidence('e2e/checkout.test.ts', '')).toBe('e2e');
  expect(classifyTestEvidence('tests/contract/users.test.ts', '')).toBe('contract');
  expect(classifyTestEvidence('tests/contracts/users.test.ts', '')).toBe('contract');

  // Reads the file when no source is given.
  const d = tempDir();
  const file = path.join(d, 'prop.test.ts');
  fs.writeFileSync(file, `import fc from ${FAST_CHECK};\n${FC_BODY}`);
  expect(classifyTestEvidence(file)).toBe('property');

  // Never throws: missing or unreadable → unit (REQ-PIPETRUST-002.A2).
  expect(classifyTestEvidence(path.join(d, 'missing.test.ts'))).toBe('unit');
  expect(classifyTestEvidence(d)).toBe('unit'); // a directory is unreadable as a file
}

async function buildCoverageFixture(): Promise<{ cg: SpecShip; dir: string }> {
  const dir = tempDir();
  fs.mkdirSync(path.join(dir, '__tests__'), { recursive: true });
  fs.writeFileSync(path.join(dir, '__tests__', 'plain.test.ts'), "import { it } from 'vitest';\n");
  fs.writeFileSync(
    path.join(dir, '__tests__', 'prop.test.ts'),
    `import fc from ${FAST_CHECK};\n${FC_BODY}`
  );
  const cg = await SpecShip.init(dir);
  const sq = cg.getSpecQueries();
  const now = Date.now();
  const addSpec = (id: string, kind: 'document' | 'requirement' | 'acceptance', body: string, parentId?: string) =>
    sq.insertSpec({
      id, kind, title: body, body, format: 'markdown', sourcePath: 'specs/ek.md',
      parentId, contentHash: 'h', createdAt: now, updatedAt: now,
    });
  const addLink = (specId: string, kind: SpecLinkKind, file: string, nodeKind: NodeKind = 'function') =>
    sq.upsertSpecLink({
      specId, targetFilePath: file, targetQualifiedName: `${specId}:${file}`, targetNodeKind: nodeKind,
      kind, state: 'verified', driftAxis: null, specHashAtLink: 'h', provenance: 'code-comment',
      confidence: 0.9, createdAt: now, updatedAt: now,
    });

  addSpec('EK-DOC', 'document', 'doc');
  addSpec('REQ-EK-001', 'requirement', 'The total MUST be correct', 'EK-DOC');
  addSpec('REQ-EK-001.A1', 'acceptance', 'The total never goes negative for any input', 'REQ-EK-001');
  addSpec('REQ-EK-001.A2', 'acceptance', 'The total of two items is their sum', 'REQ-EK-001');
  addLink('REQ-EK-001.A1', 'tests', '__tests__/plain.test.ts');
  addLink('REQ-EK-001.A2', 'tests', '__tests__/plain.test.ts');

  addSpec('REQ-EK-002', 'requirement', 'The cart page MUST render', 'EK-DOC');
  addSpec('REQ-EK-002.A1', 'acceptance', 'The cart page shows each item', 'REQ-EK-002');
  addLink('REQ-EK-002', 'implements', 'src/Cart.tsx', 'component');
  addLink('REQ-EK-002.A1', 'tests', '__tests__/plain.test.ts');

  addSpec('REQ-EK-003', 'requirement', 'The users endpoint MUST list users', 'EK-DOC');
  addSpec('REQ-EK-003.A1', 'acceptance', 'GET /users lists users', 'REQ-EK-003');
  addLink('REQ-EK-003', 'implements', 'src/routes.ts', 'route');
  return { cg, dir };
}

async function coverageReportsRequiredAndPresentKinds(): Promise<void> {
  const { cg } = await buildCoverageFixture();
  try {
    const req1 = cg.getSpecCoverage('REQ-EK-001').requirements[0]!;
    const a1 = req1.criteria.find((c) => c.specId === 'REQ-EK-001.A1')!;
    const a2 = req1.criteria.find((c) => c.specId === 'REQ-EK-001.A2')!;
    // Requires property; only a plain unit test is linked → missing its kind…
    expect(a1.requiredKind).toBe('property');
    expect(a1.presentKinds).toEqual(['unit']);
    expect(a1.kindSatisfied).toBe(false);
    // …while its verdict stays exactly as before (REQ-PIPETRUST-003.A1).
    expect(a1.verdict).toBe('verified');
    expect(a2.requiredKind).toBe('unit');
    expect(a2.kindSatisfied).toBe(true);
    expect(req1.verdict).toBe('verified');
    expect(req1.kindSatisfied).toBe(false);

    const ui = cg.getSpecCoverage('REQ-EK-002').requirements[0]!.criteria[0]!;
    expect(ui.requiredKind).toBe('e2e');
    expect(ui.kindSatisfied).toBe(false);

    const route = cg.getSpecCoverage('REQ-EK-003').requirements[0]!.criteria[0]!;
    expect(route.requiredKind).toBe('contract');
    expect(route.presentKinds).toEqual([]);
    expect(route.verdict).toBe('untested');

    const all = cg.getSpecCoverage('EK-DOC');
    expect(criteriaMissingKind(all).map((c) => c.specId).sort()).toEqual([
      'REQ-EK-001.A1', 'REQ-EK-002.A1', 'REQ-EK-003.A1',
    ]);
    expect(all.evidence.criteriaMissingKind).toBe(3);
    // The existing totals keep their shape.
    expect(Object.keys(all.totals).sort()).toEqual(
      ['criteria', 'criteriaBroken', 'criteriaVerified', 'criteriaWithTests', 'requirements']
    );
  } finally {
    cg.close();
  }
}

async function requireKindsFailsOnMissingKind(): Promise<void> {
  const { cg } = await buildCoverageFixture();
  try {
    const before = cg.getSpecCoverage('REQ-EK-001');
    expect(requireKindsExitCode(before, true)).not.toBe(0);
    // Without the flag, kinds never fail the command.
    expect(requireKindsExitCode(before, false)).toBe(0);

    // Link a property test to the property criterion → every criterion has its kind.
    const now = Date.now();
    cg.getSpecQueries().upsertSpecLink({
      specId: 'REQ-EK-001.A1', targetFilePath: '__tests__/prop.test.ts', targetQualifiedName: 'propFn',
      targetNodeKind: 'function', kind: 'tests', state: 'verified', driftAxis: null, specHashAtLink: 'h',
      provenance: 'code-comment', confidence: 0.9, createdAt: now, updatedAt: now,
    });
    const after = cg.getSpecCoverage('REQ-EK-001');
    const a1 = after.requirements[0]!.criteria.find((c) => c.specId === 'REQ-EK-001.A1')!;
    expect(a1.presentKinds).toEqual(['unit', 'property']);
    expect(a1.kindSatisfied).toBe(true);
    expect(requireKindsExitCode(after, true)).toBe(0);
  } finally {
    cg.close();
  }
}

describe('required evidence kind (REQ-PIPETRUST-001)', () => {
  it('a declared (evidence: kind) tag wins over wording and links (REQ-PIPETRUST-001.A1)', declaredKindWins);
  it('without a tag the kind derives from shape, UI link, route link, else unit (REQ-PIPETRUST-001.A2)', derivedKindFollowsCriterionShape);
  it('an unknown declared kind is a lint error (REQ-PIPETRUST-001.A3)', unknownDeclaredKindIsALintError);
});

describe('test evidence classification (REQ-PIPETRUST-002)', () => {
  it('classifies test files as property / e2e / contract / unit and never throws (REQ-PIPETRUST-002.A1, REQ-PIPETRUST-002.A2)', classifiesTestFilesByKind);
});

describe.skipIf(!fts5Available)('kind-aware coverage (REQ-PIPETRUST-003)', () => {
  it('reports required and present kinds per criterion without changing verdicts (REQ-PIPETRUST-003.A1)', coverageReportsRequiredAndPresentKinds);
  it('--require-kinds exits non-zero on a missing kind and zero when all are present (REQ-PIPETRUST-003.A2)', requireKindsFailsOnMissingKind);
});
