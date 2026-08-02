/**
 * Regression pack tests — REQ-JIRAREG-001.
 *
 * The builder + upsert both run against fakes here — no real JIRA, no real
 * SqliteDatabase. The BuilderSpecQueries structural interface makes the
 * builder trivial to fixture; the RegressionPackJiraClient interface makes
 * the upsert a straightforward in-memory recorder.
 *
 * A1 — single-epic invariant: one canonical pack epic, extras surfaced as orphans.
 * A2 — every implemented criterion becomes one case, titled with its id + text.
 * A3 — case body names the source criterion + spec; spec file records the case key.
 * A4 — an authored-only requirement (no implements-kind link) yields zero cases.
 * Plus: idempotency (a second identical upsert is all-skip) and
 * `regression_cases:` back-link block is invisible to the markdown spec extractor.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Spec, SpecLink } from '../../src/types';
import {
  buildRegressionPack,
  upsertRegressionPack,
  groupCasesByDomain,
  renderCaseSteps,
  recordRunResult,
  regressionContentFingerprint,
  readStoredFingerprint,
  REG_PACK_EPIC_LABEL,
  REG_PACK_CASE_LABEL_PREFIX,
  REG_PACK_CASE_MARKER_LABEL,
  REG_PACK_OBSOLETE_LABEL,
  REG_PACK_OBSOLETE_WATERMARK_PREFIX,
  type BuilderSpecQueries,
  type RegressionPackJiraClient,
} from '../../src/jira/regression-pack';
import {
  writeRegressionCaseKeys,
  addRegressionCaseKeyToSource,
} from '../../src/jira/spec-writer';
import { MarkdownSpecExtractor } from '../../src/extraction/specs/markdown-spec-extractor';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const NOW = 1_700_000_000_000;

function makeReq(id: string, title: string, sourcePath = `specs/${id.toLowerCase()}.md`): Spec {
  return {
    id,
    kind: 'requirement',
    title,
    body: title,
    format: 'markdown',
    sourcePath,
    contentHash: 'req-hash',
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function makeAcceptance(id: string, parentId: string, text: string, sourcePath: string): Spec {
  return {
    id,
    kind: 'acceptance',
    title: text,
    body: text,
    format: 'markdown',
    sourcePath,
    parentId,
    contentHash: 'a-hash',
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function makeLink(
  specId: string,
  kind: SpecLink['kind'],
  state: SpecLink['state'],
  id = Math.floor(Math.random() * 1_000_000),
): SpecLink {
  return {
    id,
    specId,
    targetFilePath: 'src/foo.ts',
    targetQualifiedName: 'foo',
    targetNodeKind: 'function',
    kind,
    state,
    specHashAtLink: 'req-hash',
    provenance: 'agent-asserted',
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function fakeQueries(opts: {
  specs: Spec[];
  linksBySpec?: Record<string, SpecLink[]>;
}): BuilderSpecQueries {
  const bySpec = opts.linksBySpec ?? {};
  return {
    getAllSpecs: () => opts.specs,
    getSpecsByParent: (pid: string) => opts.specs.filter((s) => s.parentId === pid),
    getLinksBySpec: (sid: string) => bySpec[sid] ?? [],
  };
}

// A minimal in-memory JIRA fake that satisfies RegressionPackJiraClient.
interface FakeIssue {
  key: string;
  summary: string;
  description: string;
  labels: string[];
  parentKey?: string;
  issueType: string;
}

function makeFake(seed: FakeIssue[] = []) {
  const issues = new Map<string, FakeIssue>();
  const commentsByKey = new Map<string, Array<{ id: string; body: string }>>();
  for (const s of seed) issues.set(s.key, { ...s });
  let next = 100;
  let nextCommentId = 1;
  const created: string[] = [];
  const updated: string[] = [];
  const commentsAdded: Array<{ key: string; body: string }> = [];
  const labelsAdded: Array<{ key: string; label: string }> = [];
  const client: RegressionPackJiraClient = {
    async searchIssuesByLabel(_projectKey, label) {
      const out: Array<{ key: string; summary: string }> = [];
      for (const i of issues.values()) {
        if (i.labels.includes(label)) out.push({ key: i.key, summary: i.summary });
      }
      return out;
    },
    async getIssue(key) {
      const i = issues.get(key);
      if (!i) throw new Error(`no such issue ${key}`);
      return { ok: true, issue: { key: i.key, summary: i.summary, description: i.description } };
    },
    async createIssue(fields) {
      const key = `${fields.projectKey}-${next++}`;
      issues.set(key, {
        key,
        summary: fields.summary,
        description: fields.description ?? '',
        labels: fields.labels ?? [],
        parentKey: fields.parentKey,
        issueType: fields.issueType,
      });
      created.push(key);
      return { key, id: String(next) };
    },
    async updateIssue(key, fields) {
      const i = issues.get(key);
      if (!i) throw new Error(`no such issue ${key}`);
      if (fields.summary !== undefined) i.summary = fields.summary;
      if (fields.description !== undefined) i.description = fields.description;
      updated.push(key);
    },
    async listCommentsDetailed(key) {
      const i = issues.get(key);
      if (!i) throw new Error(`no such issue ${key}`);
      return (commentsByKey.get(key) ?? []).map((c) => ({ ...c }));
    },
    async addComment(key, body) {
      const i = issues.get(key);
      if (!i) throw new Error(`no such issue ${key}`);
      const id = `C${nextCommentId++}`;
      const list = commentsByKey.get(key) ?? [];
      list.push({ id, body });
      commentsByKey.set(key, list);
      commentsAdded.push({ key, body });
      return { id };
    },
    async addLabel(key, label) {
      const i = issues.get(key);
      if (!i) throw new Error(`no such issue ${key}`);
      if (i.labels.includes(label)) return { added: false };
      i.labels.push(label);
      labelsAdded.push({ key, label });
      return { added: true };
    },
  };
  return { client, issues, created, updated, commentsAdded, labelsAdded, commentsByKey };
}

// ---------------------------------------------------------------------------
// Builder — A2, A4, ordering
// ---------------------------------------------------------------------------

describe('buildRegressionPack — REQ-JIRAREG-001 (A2, A4)', () => {
  it('emits one case per acceptance criterion of every implemented requirement (A2)', () => {
    const req1 = makeReq('REQ-FOO-001', 'Login rate-limited');
    const req1a1 = makeAcceptance('REQ-FOO-001.A1', req1.id, 'A 6th attempt returns 429.', req1.sourcePath);
    const req1a2 = makeAcceptance('REQ-FOO-001.A2', req1.id, 'A success resets the counter.', req1.sourcePath);
    const req2 = makeReq('REQ-BAR-002', 'Password reset flow');
    const req2a1 = makeAcceptance('REQ-BAR-002.A1', req2.id, 'Reset email sent within 10 seconds.', req2.sourcePath);

    const sq = fakeQueries({
      specs: [req1, req1a1, req1a2, req2, req2a1],
      linksBySpec: {
        [req1.id]: [makeLink(req1.id, 'implements', 'implemented')],
        [req2a1.id]: [makeLink(req2a1.id, 'implements', 'verified')],
      },
    });

    const model = buildRegressionPack(sq);
    expect(model.cases).toHaveLength(3);
    // Deterministic ordering: requirements sorted by id.
    expect(model.cases.map((c) => c.criterionId)).toEqual([
      'REQ-BAR-002.A1',
      'REQ-FOO-001.A1',
      'REQ-FOO-001.A2',
    ]);
    // Case summary carries the id + criterion text (A2).
    expect(model.cases[0].summary).toContain('REQ-BAR-002.A1');
    expect(model.cases[0].summary).toContain('Reset email');
    // Case body records the source criterion + spec path (A3).
    expect(model.cases[0].description).toContain('Source: REQ-BAR-002.A1');
    expect(model.cases[0].description).toContain(req2.sourcePath);
  });

  it('excludes authored-but-unimplemented requirements (A4)', () => {
    const req = makeReq('REQ-DRAFT-001', 'Authored only');
    const acc = makeAcceptance('REQ-DRAFT-001.A1', req.id, 'Something.', req.sourcePath);
    const sq = fakeQueries({
      specs: [req, acc],
      // No implements-kind link → not implemented.
      linksBySpec: { [req.id]: [makeLink(req.id, 'documents', 'implemented')] },
    });
    const model = buildRegressionPack(sq);
    expect(model.cases).toHaveLength(0);
  });

  it('files every case under the Uncategorised placeholder area (REQ-JIRAREG-002 refines)', () => {
    const req = makeReq('REQ-Z-001', 'Only');
    const acc = makeAcceptance('REQ-Z-001.A1', req.id, 'x', req.sourcePath);
    const sq = fakeQueries({
      specs: [req, acc],
      linksBySpec: { [req.id]: [makeLink(req.id, 'implements', 'implemented')] },
    });
    const model = buildRegressionPack(sq);
    expect(model.stories).toHaveLength(1);
    expect(model.stories[0].domainArea).toBe('Uncategorised');
  });

  it('groupCasesByDomain is a passthrough in 001 — same input, same output', () => {
    const grouped = groupCasesByDomain([
      { reqId: 'R1', criterionId: 'R1.A1', criterionText: 't', specPath: 's', tier: 'unknown', domainArea: 'Uncategorised' },
      { reqId: 'R1', criterionId: 'R1.A2', criterionText: 'u', specPath: 's', tier: 'unknown', domainArea: 'Uncategorised' },
    ]);
    expect(grouped.size).toBe(1);
    expect(grouped.get('Uncategorised')).toHaveLength(2);
  });

  it('rolls up implementation up from acceptance children (not just the req itself)', () => {
    const req = makeReq('REQ-CHILD-001', 'Only accepts on children');
    const acc = makeAcceptance('REQ-CHILD-001.A1', req.id, 'x', req.sourcePath);
    const sq = fakeQueries({
      specs: [req, acc],
      linksBySpec: { [acc.id]: [makeLink(acc.id, 'implements', 'implemented')] },
    });
    const model = buildRegressionPack(sq);
    expect(model.cases).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Upsert — A1 (single-epic), idempotency
// ---------------------------------------------------------------------------

describe('upsertRegressionPack — REQ-JIRAREG-001 (A1, idempotency)', () => {
  function makeModel() {
    const req = makeReq('REQ-FOO-001', 'Rate limit');
    const a1 = makeAcceptance('REQ-FOO-001.A1', req.id, 'A 6th attempt returns 429.', req.sourcePath);
    const sq = fakeQueries({
      specs: [req, a1],
      linksBySpec: { [req.id]: [makeLink(req.id, 'implements', 'implemented')] },
    });
    return buildRegressionPack(sq);
  }

  it('creates exactly one pack epic on the first run (A1)', async () => {
    const model = makeModel();
    const { client, issues, created } = makeFake();
    const result = await upsertRegressionPack(client, model, { projectKey: 'PROJ' });
    expect(result.epicCreated).toBe(true);
    expect(result.storiesCreated).toBe(1);
    expect(result.casesCreated).toBe(1);
    expect(result.orphanedEpicKeys).toEqual([]);
    // Epic carries the SpecShip regression-pack label.
    const epic = issues.get(result.epicKey!)!;
    expect(epic.labels).toContain(REG_PACK_EPIC_LABEL);
    expect(created).toHaveLength(3); // epic + story + case
  });

  it('a second run with nothing changed performs zero writes (idempotent, A1 for extras)', async () => {
    const model = makeModel();
    const fake = makeFake();
    await upsertRegressionPack(fake.client, model, { projectKey: 'PROJ' });
    // Reset the recorded arrays but keep the seeded issues.
    fake.created.length = 0;
    fake.updated.length = 0;
    const again = await upsertRegressionPack(fake.client, model, { projectKey: 'PROJ' });
    expect(again.storiesCreated).toBe(0);
    expect(again.casesCreated).toBe(0);
    expect(again.storiesUpdated + again.casesUpdated).toBe(0);
    expect(again.storiesSkipped).toBe(1);
    expect(again.casesSkipped).toBe(1);
    expect(fake.created).toHaveLength(0);
    expect(fake.updated).toHaveLength(0);
  });

  it('editing one case yields exactly one update, others skipped', async () => {
    const model = makeModel();
    const fake = makeFake();
    await upsertRegressionPack(fake.client, model, { projectKey: 'PROJ' });

    // Mutate the model's case description → new fingerprint → one updated case.
    const rewritten = {
      ...model,
      cases: model.cases.map((c) => ({
        ...c,
        description: c.description.replace(/regfp:[a-f0-9]+/, '') + '\nEDITED',
      })),
      stories: model.stories.map((s) => ({
        ...s,
        cases: s.cases.map((c) => ({
          ...c,
          description: c.description.replace(/regfp:[a-f0-9]+/, '') + '\nEDITED',
        })),
      })),
    };
    fake.created.length = 0;
    fake.updated.length = 0;
    const again = await upsertRegressionPack(fake.client, rewritten, { projectKey: 'PROJ' });
    expect(again.casesUpdated).toBe(1);
    expect(again.casesCreated).toBe(0);
    expect(fake.updated).toHaveLength(1); // one case body
  });

  it('picks the oldest-key canonical epic when duplicates exist, reports the rest as orphans (A1)', async () => {
    const model = makeModel();
    // Pre-seed two epics with the pack label.
    const fake = makeFake([
      {
        key: 'PROJ-1',
        summary: 'SpecShip Regression Pack',
        description: '',
        labels: [REG_PACK_EPIC_LABEL],
        issueType: 'Epic',
      },
      {
        key: 'PROJ-2',
        summary: 'Duplicate pack epic',
        description: '',
        labels: [REG_PACK_EPIC_LABEL],
        issueType: 'Epic',
      },
    ]);
    const result = await upsertRegressionPack(fake.client, model, { projectKey: 'PROJ' });
    expect(result.epicKey).toBe('PROJ-1');
    expect(result.epicCreated).toBe(false);
    expect(result.orphanedEpicKeys).toEqual(['PROJ-2']);
  });

  it('dry_run performs zero writes but still reports the plan', async () => {
    const model = makeModel();
    const fake = makeFake();
    const result = await upsertRegressionPack(fake.client, model, {
      projectKey: 'PROJ',
      dryRun: true,
    });
    expect(fake.created).toHaveLength(0);
    expect(fake.updated).toHaveLength(0);
    expect(result.epicCreated).toBe(true); // planned
  });
});

// ---------------------------------------------------------------------------
// Fingerprint helpers + render
// ---------------------------------------------------------------------------

describe('regression-pack helpers', () => {
  it('readStoredFingerprint round-trips the tag', () => {
    const fp = regressionContentFingerprint('hello', 'world');
    const desc = `body\n\n<!-- specship:regfp:${fp} -->`;
    expect(readStoredFingerprint(desc)).toBe(fp);
  });

  it('renderCaseSteps names the source criterion + spec (A3)', () => {
    const body = renderCaseSteps({
      reqId: 'REQ-X-001',
      criterionId: 'REQ-X-001.A1',
      criterionText: 'It happens.',
      specPath: 'specs/x.md',
      tier: 'unknown',
      domainArea: 'Uncategorised',
    });
    expect(body).toContain('REQ-X-001.A1');
    expect(body).toContain('specs/x.md');
    expect(body).toContain('Source:');
  });

  it('recordRunResult is a REQ-JIRAREG-005 stub in this run', () => {
    const out = recordRunResult(null, { caseKey: 'PROJ-9', verdict: 'passed' });
    expect(out.pending).toBe(true);
    expect(out.summary).toContain('PROJ-9');
    expect(out.summary).toContain('REQ-JIRAREG-005');
  });
});

// ---------------------------------------------------------------------------
// Back-linker + extractor safety (A3 + JIRAREG feedback #4)
// ---------------------------------------------------------------------------

describe('writeRegressionCaseKeys — REQ-JIRAREG-001 (A3)', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-regpack-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const SPEC_SOURCE = [
    '# Doc',
    '',
    '<!-- id: REQ-FOO-001 -->',
    '## The requirement',
    '',
    'Body.',
    '',
    'implementations:',
    '  - src/foo.ts:foo',
    '',
    '## Acceptance',
    '<!-- id: REQ-FOO-001.A1 -->',
    '- A 6th attempt returns 429.',
    '<!-- id: REQ-FOO-001.A2 -->',
    '- A success resets the counter.',
    '',
  ].join('\n');

  it('inserts a regression_cases: block under the criterion (idempotent on rerun)', () => {
    const specPath = path.join(dir, 'foo.md');
    fs.writeFileSync(specPath, SPEC_SOURCE, 'utf8');
    const first = writeRegressionCaseKeys(specPath, 'REQ-FOO-001.A1', 'PROJ-42');
    expect(first.changed).toBe(true);
    const written = fs.readFileSync(specPath, 'utf8');
    expect(written).toContain('regression_cases:');
    expect(written).toContain('- PROJ-42');
    const again = writeRegressionCaseKeys(specPath, 'REQ-FOO-001.A1', 'PROJ-42');
    expect(again.changed).toBe(false);
  });

  it('reports a missing criterion cleanly (no crash)', () => {
    const specPath = path.join(dir, 'foo.md');
    fs.writeFileSync(specPath, SPEC_SOURCE, 'utf8');
    const out = writeRegressionCaseKeys(specPath, 'REQ-NOPE-999.A1', 'PROJ-1');
    expect(out.changed).toBe(false);
    expect(out.detail).toMatch(/not found/);
  });

  it('a regression_cases: block does NOT bleed into an adjacent implementations:/verifies: parse', () => {
    // Author a spec where regression_cases: sits between implementations: and verifies:.
    // The markdown spec extractor MUST recognise both real blocks and ignore the
    // regression_cases: bullets entirely.
    const source = [
      '# Doc',
      '',
      '<!-- id: REQ-MIX-001 -->',
      '## The requirement',
      '',
      'implementations:',
      '  - src/mix.ts:doThing',
      '',
      'regression_cases:',
      '  - PROJ-99',
      '',
      'verifies:',
      '  - __tests__/mix.test.ts:coversDoThing',
      '',
      '## Acceptance',
      '<!-- id: REQ-MIX-001.A1 -->',
      '- It works.',
      '',
    ].join('\n');
    const specPath = path.join(dir, 'mix.md');
    fs.writeFileSync(specPath, source, 'utf8');
    const extractor = new MarkdownSpecExtractor(specPath, source);
    const result = extractor.extract();

    // Both real blocks parsed; regression_cases bullet NEVER became a link.
    const kinds = result.linkCandidates.map((l) => `${l.kind}:${l.targetFilePath}`);
    expect(kinds).toContain('implements:src/mix.ts');
    expect(kinds).toContain('tests:__tests__/mix.test.ts');
    expect(
      result.linkCandidates.some((l) => l.targetFilePath === 'PROJ-99'),
    ).toBe(false);
  });

  it('addRegressionCaseKeyToSource appends further keys under an existing block', () => {
    const start = [
      '<!-- id: REQ-ADD-001.A1 -->',
      '- Something.',
      '',
      'regression_cases:',
      '  - PROJ-1',
      '',
    ].join('\n');
    const res = addRegressionCaseKeyToSource(start, 'REQ-ADD-001.A1', 'PROJ-2');
    expect(res.changed).toBe(true);
    expect(res.source).toContain('- PROJ-1');
    expect(res.source).toContain('- PROJ-2');
  });
});

// ---------------------------------------------------------------------------
// Label + case-key wiring
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// REQ-JIRAREG-003 — idempotent maintenance (add / update / obsolete / zero-write)
// ---------------------------------------------------------------------------

describe('upsertRegressionPack — REQ-JIRAREG-003 (add/update/obsolete)', () => {
  function buildModel(criteria: Array<{ suffix: string; text: string }>) {
    const req = makeReq('REQ-MAINT-001', 'Maintainable pack');
    const accs = criteria.map((c) =>
      makeAcceptance(`REQ-MAINT-001.${c.suffix}`, req.id, c.text, req.sourcePath),
    );
    const sq = fakeQueries({
      specs: [req, ...accs],
      linksBySpec: { [req.id]: [makeLink(req.id, 'implements', 'implemented')] },
    });
    return buildRegressionPack(sq);
  }

  it('A1: adding a criterion creates exactly one new case; nothing else changes', async () => {
    const before = buildModel([{ suffix: 'A1', text: 'First check.' }]);
    const fake = makeFake();
    await upsertRegressionPack(fake.client, before, { projectKey: 'PROJ' });

    fake.created.length = 0;
    fake.updated.length = 0;
    fake.commentsAdded.length = 0;
    fake.labelsAdded.length = 0;

    const after = buildModel([
      { suffix: 'A1', text: 'First check.' },
      { suffix: 'A2', text: 'Second check.' },
    ]);
    const result = await upsertRegressionPack(fake.client, after, { projectKey: 'PROJ' });

    expect(result.casesCreated).toBe(1);
    expect(result.casesUpdated).toBe(0);
    expect(result.casesObsoleted).toBe(0);
    expect(fake.created).toHaveLength(1); // exactly one new case created
    // No obsolete write path fired.
    expect(fake.commentsAdded).toHaveLength(0);
    expect(fake.labelsAdded).toHaveLength(0);
    // Story + epic body legitimately refresh to reflect the new case count —
    // that's fingerprint drift on the container bodies, not case-level churn.
    // What A1 forbids is a duplicate case or an unrelated case edit.
    for (const key of fake.updated) {
      const issue = fake.issues.get(key)!;
      expect(issue.issueType).not.toBe('Sub-task');
    }
  });

  it('A2: editing a criterion updates its case in place — same key, no duplicate', async () => {
    const before = buildModel([{ suffix: 'A1', text: 'Original text.' }]);
    const fake = makeFake();
    const first = await upsertRegressionPack(fake.client, before, { projectKey: 'PROJ' });
    const caseKey = first.caseKeysByCriterion['REQ-MAINT-001.A1'];
    expect(caseKey).toBeTruthy();

    fake.created.length = 0;
    fake.updated.length = 0;

    const after = buildModel([{ suffix: 'A1', text: 'Edited text — different now.' }]);
    const result = await upsertRegressionPack(fake.client, after, { projectKey: 'PROJ' });

    expect(result.casesCreated).toBe(0);
    expect(result.casesUpdated).toBe(1);
    expect(result.casesObsoleted).toBe(0);
    expect(result.caseKeysByCriterion['REQ-MAINT-001.A1']).toBe(caseKey); // same key
    expect(fake.created).toHaveLength(0);
    expect(fake.updated).toContain(caseKey);
    // Updated body reflects new criterion text.
    expect(fake.issues.get(caseKey)!.description).toContain('Edited text');
  });

  it('A3: removing a criterion marks the case obsolete (comment + label), issue preserved', async () => {
    const before = buildModel([
      { suffix: 'A1', text: 'Kept.' },
      { suffix: 'A2', text: 'Removed later.' },
    ]);
    const fake = makeFake();
    const first = await upsertRegressionPack(fake.client, before, { projectKey: 'PROJ' });
    const keptKey = first.caseKeysByCriterion['REQ-MAINT-001.A1'];
    const removedKey = first.caseKeysByCriterion['REQ-MAINT-001.A2'];
    expect(removedKey).toBeTruthy();

    fake.created.length = 0;
    fake.updated.length = 0;
    fake.commentsAdded.length = 0;
    fake.labelsAdded.length = 0;

    const after = buildModel([{ suffix: 'A1', text: 'Kept.' }]);
    const result = await upsertRegressionPack(fake.client, after, { projectKey: 'PROJ' });

    expect(result.casesObsoleted).toBe(1);
    expect(result.obsoletedCaseKeys).toEqual([removedKey]);

    // Original issue still exists (never deleted) — run history preserved.
    expect(fake.issues.has(removedKey)).toBe(true);
    // Kept case still there and skipped, not touched.
    expect(fake.issues.has(keptKey)).toBe(true);

    // Watermarked obsolete comment present with the reason.
    const commentBodies = (fake.commentsByKey.get(removedKey) ?? []).map((c) => c.body);
    expect(commentBodies.some((b) => b.startsWith(REG_PACK_OBSOLETE_WATERMARK_PREFIX))).toBe(true);
    expect(commentBodies.some((b) => b.includes('reason=removed'))).toBe(true);
    expect(commentBodies.some((b) => b.includes('obsolete'))).toBe(true);

    // Board-filterable obsolete label attached.
    expect(fake.issues.get(removedKey)!.labels).toContain(REG_PACK_OBSOLETE_LABEL);

    // No destructive workflow transition happened; no updateIssue write on
    // the obsoleted case body.
    expect(fake.updated).not.toContain(removedKey);
  });

  it('A4: running maintenance twice in a row performs zero writes on the second run', async () => {
    const model = buildModel([
      { suffix: 'A1', text: 'One.' },
      { suffix: 'A2', text: 'Two.' },
    ]);
    const fake = makeFake();

    // Run 1: creates.
    await upsertRegressionPack(fake.client, model, { projectKey: 'PROJ' });

    // Now remove one criterion and run — one obsoletion happens (first-time write).
    const trimmed = buildModel([{ suffix: 'A1', text: 'One.' }]);
    await upsertRegressionPack(fake.client, trimmed, { projectKey: 'PROJ' });

    fake.created.length = 0;
    fake.updated.length = 0;
    fake.commentsAdded.length = 0;
    fake.labelsAdded.length = 0;

    // Run 3: identical to run 2 → zero writes.
    const result = await upsertRegressionPack(fake.client, trimmed, { projectKey: 'PROJ' });

    expect(result.casesCreated).toBe(0);
    expect(result.casesUpdated).toBe(0);
    expect(result.casesObsoleted).toBe(0);
    expect(fake.created).toHaveLength(0);
    expect(fake.updated).toHaveLength(0);
    expect(fake.commentsAdded).toHaveLength(0);
    expect(fake.labelsAdded).toHaveLength(0);
  });

  it('every case carries the fixed case marker label alongside its per-case slug', async () => {
    const model = buildModel([{ suffix: 'A1', text: 'x.' }]);
    const fake = makeFake();
    const result = await upsertRegressionPack(fake.client, model, { projectKey: 'PROJ' });
    const caseKey = result.caseKeysByCriterion['REQ-MAINT-001.A1'];
    const labels = fake.issues.get(caseKey)!.labels;
    expect(labels).toContain(REG_PACK_CASE_MARKER_LABEL);
    // Pack epic and area story MUST NOT carry the case marker label
    // (orphan scan invariant).
    expect(fake.issues.get(result.epicKey!)!.labels).not.toContain(REG_PACK_CASE_MARKER_LABEL);
    for (const [, issue] of fake.issues) {
      if (issue.issueType === 'Story') {
        expect(issue.labels).not.toContain(REG_PACK_CASE_MARKER_LABEL);
      }
    }
  });
});

describe('regression-pack labels', () => {
  it('every case has a stable slug label prefixed for JQL lookup', () => {
    const req = makeReq('REQ-BAZ-001', 'x');
    const a1 = makeAcceptance('REQ-BAZ-001.A1', req.id, 'text', req.sourcePath);
    const sq = fakeQueries({
      specs: [req, a1],
      linksBySpec: { [req.id]: [makeLink(req.id, 'implements', 'implemented')] },
    });
    const model = buildRegressionPack(sq);
    expect(model.cases[0].label.startsWith(REG_PACK_CASE_LABEL_PREFIX)).toBe(true);
    expect(model.cases[0].label).toContain('req-baz-001');
  });
});
