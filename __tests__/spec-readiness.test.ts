import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assessReadinessFromFile, formatEvidencePlan, suggestedTestName } from '../src/spec-quality/readiness';

/**
 * PIPETRUST-DOC REQ-PIPETRUST-004 — implement must not start on a spec that is
 * not ready; a ready spec yields an evidence plan. File-based, so these run
 * against a throwaway project with only a specs/ directory (no index).
 */

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ready-'));
  fs.mkdirSync(path.join(root, 'specs'));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function writeSpec(body: string): void {
  fs.writeFileSync(
    path.join(root, 'specs', 'demo.md'),
    ['---', 'id: DEMO-DOC', 'title: Demo', '---', '', '<!-- id: DEMO-DOC -->', '# Demo', '', body].join('\n'),
  );
}

const READY = [
  '<!-- id: REQ-DEMO-001 -->',
  '## Login attempts MUST be rate-limited',
  '',
  'implementations:',
  '  - src/auth/rate-limit.ts:RateLimiter',
  '',
  '## Acceptance',
  '<!-- id: REQ-DEMO-001.A1 -->',
  '- The 6th failed attempt in 60 s is refused with 429.',
  '<!-- id: REQ-DEMO-001.A2 -->',
  '- A rejected attempt never resets the counter.',
  '<!-- id: REQ-DEMO-001.A3 -->',
  '- The login page shows the retry time (evidence: e2e).',
  '',
].join('\n');

function readySpecPrintsEvidencePlan(): void {
  writeSpec(READY);
  const result = assessReadinessFromFile(root, 'REQ-DEMO-001');
  expect(result.ready).toBe(true);
  expect(result.plan.map((p) => [p.criterionId, p.kind, p.testName])).toEqual([
    ['REQ-DEMO-001.A1', 'unit', 'reqDemo001A1'],
    ['REQ-DEMO-001.A2', 'property', 'reqDemo001A2'], // "never" → invariant → property
    ['REQ-DEMO-001.A3', 'e2e', 'reqDemo001A3'], // declared
  ]);
  const text = formatEvidencePlan(result);
  expect(text).toContain('READY=yes REQ-DEMO-001');
  expect(text).toContain('REQ-DEMO-001.A2 → property → reqDemo001A2');
  expect(suggestedTestName('REQ-PIPETRUST-004.A1')).toBe('reqPipetrust004A1');
}

function notReadyWhenCriterionNeedsReview(): void {
  writeSpec(READY.replace('- The 6th failed attempt in 60 s is refused with 429.', '- The 6th attempt is refused [needs review: which status code].'));
  const result = assessReadinessFromFile(root, 'REQ-DEMO-001');
  expect(result.ready).toBe(false);
  expect(result.reasons.join('\n')).toMatch(/REQ-DEMO-001\.A1.*needs review/);
  expect(formatEvidencePlan(result)).toContain('READY=no REQ-DEMO-001');
}

function notReadyWithoutCriteria(): void {
  writeSpec(['<!-- id: REQ-DEMO-002 -->', '## Something MUST happen', '', 'Prose only.', ''].join('\n'));
  const result = assessReadinessFromFile(root, 'REQ-DEMO-002');
  expect(result.ready).toBe(false);
  expect(result.reasons.join('\n')).toContain('has no acceptance criteria');
  // An unknown id is never "ready".
  expect(assessReadinessFromFile(root, 'REQ-NOPE-001').ready).toBe(false);
}

describe('spec readiness gate (REQ-PIPETRUST-004)', () => {
  it('a ready spec prints its evidence plan (REQ-PIPETRUST-004.A1)', readySpecPrintsEvidencePlan);
  it('a [needs review] criterion makes the spec not ready (REQ-PIPETRUST-004.A2)', notReadyWhenCriterionNeedsReview);
  it('a requirement without criteria is not ready (REQ-PIPETRUST-004.A2)', notReadyWithoutCriteria);
});
