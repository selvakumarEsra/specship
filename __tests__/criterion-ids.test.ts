import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { criterionIdsInText } from '../src/spec-quality/criterion-ids';
import { scanTestTitleRefs } from '../src/resolution/test-title-links';
import { checkVerifiesCoverage } from '../src/spec-quality/postcheck';

/**
 * PIPETRUST-DOC REQ-PIPETRUST-008 — criterion shorthand in a test title names
 * every criterion it lists, for both the title scanner and postcheck.
 */

function shorthandChainsExpand(): void {
  expect(criterionIdsInText('(REQ-X-004.A1/A3)')).toEqual(['REQ-X-004.A1', 'REQ-X-004.A3']);
  expect(criterionIdsInText('(REQ-X-028.A2/.A3)')).toEqual(['REQ-X-028.A2', 'REQ-X-028.A3']);
  expect(criterionIdsInText('(REQ-X-005.A1/A2/A3/A5)')).toEqual([
    'REQ-X-005.A1', 'REQ-X-005.A2', 'REQ-X-005.A3', 'REQ-X-005.A5',
  ]);
  expect(criterionIdsInText('(REQ-X-001.A1 / A3)')).toEqual(['REQ-X-001.A1', 'REQ-X-001.A3']);
  expect(criterionIdsInText('(REQ-X-001.A1, REQ-Y-002.A2)')).toEqual(['REQ-X-001.A1', 'REQ-Y-002.A2']);
  // Ids without a criterion suffix still come through; a lone A2 names nothing.
  expect(criterionIdsInText('covers REQ-X-001 and VSTATE-DOC')).toEqual(['REQ-X-001', 'VSTATE-DOC']);
  expect(criterionIdsInText('see A2 and A/B testing')).toEqual([]);
}

function idsMatchWhole(): void {
  expect(criterionIdsInText('(REQ-X-001.A10)')).toEqual(['REQ-X-001.A10']);
  expect(criterionIdsInText('(REQ-X-001.A10)')).not.toContain('REQ-X-001.A1');
}

function titleScannerLinksEveryShorthandCriterion(): void {
  const refs = scanTestTitleRefs("it('survives a re-index (REQ-TVIZ-003.A1/A3)', fn);\n");
  expect(refs.map((r) => r.specId)).toEqual(['REQ-TVIZ-003.A1', 'REQ-TVIZ-003.A3']);
  expect(new Set(refs.map((r) => r.title)).size).toBe(1);
}

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'crit-ids-'));
  fs.mkdirSync(path.join(root, '__tests__'));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const SPEC = [
  '<!-- id: REQ-DEMO-001 -->',
  '## Something MUST happen',
  '',
  'verifies:',
  '  - __tests__/demo.test.ts:both',
  '',
  '## Acceptance',
  '<!-- id: REQ-DEMO-001.A1 -->',
  '- First.',
  '<!-- id: REQ-DEMO-001.A2 -->',
  '- Second.',
  '',
].join('\n');

function postcheckCountsShorthandCriteria(): void {
  fs.writeFileSync(path.join(root, '__tests__', 'demo.test.ts'), "function both(): void {}\nit('does both (REQ-DEMO-001.A1/A2)', both);\n");
  expect(checkVerifiesCoverage(root, SPEC, 'REQ-DEMO-001')).toEqual([]);
  // A10 is not evidence for A1.
  fs.writeFileSync(path.join(root, '__tests__', 'demo.test.ts'), "function both(): void {}\nit('x (REQ-DEMO-001.A10, REQ-DEMO-001.A2)', both);\n");
  const msgs = checkVerifiesCoverage(root, SPEC, 'REQ-DEMO-001').map((f) => f.message);
  expect(msgs).toHaveLength(1);
  expect(msgs[0]).toMatch(/REQ-DEMO-001\.A1 has no test evidence/);
}

describe('criterion ids in text (REQ-PIPETRUST-008)', () => {
  it('shorthand chains expand to every full id; a lone A2 names nothing (REQ-PIPETRUST-008.A1)', shorthandChainsExpand);
  it('ids match whole — A10 is not A1 (REQ-PIPETRUST-008.A2)', idsMatchWhole);
  it('the title scanner yields one ref per shorthand criterion (REQ-PIPETRUST-008.A3)', titleScannerLinksEveryShorthandCriterion);
  it('postcheck counts criteria named through shorthand (REQ-PIPETRUST-008.A4, REQ-PIPETRUST-008.A2)', postcheckCountsShorthandCriteria);
});
