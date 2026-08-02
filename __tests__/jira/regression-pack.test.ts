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
  computeDomainAreasByReqId,
  renderDomainGapReport,
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
  const byId = new Map<string, Spec>();
  for (const s of opts.specs) byId.set(s.id, s);
  return {
    getAllSpecs: () => opts.specs,
    getSpecsByParent: (pid: string) => opts.specs.filter((s) => s.parentId === pid),
    getLinksBySpec: (sid: string) => bySpec[sid] ?? [],
    getSpecById: (id: string) => byId.get(id),
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
      return {
        ok: true,
        issue: {
          key: i.key,
          summary: i.summary,
          description: i.description,
          ...(i.parentKey ? { parentKey: i.parentKey } : {}),
        },
      };
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
      if (fields.parentKey !== undefined) i.parentKey = fields.parentKey;
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
    // Case body records the source criterion id (A3). The spec PATH is not
    // in the body — REQ-JIRAREG-004.A1 keeps white-box detail off the pack.
    expect(model.cases[0].description).toContain('Source: REQ-BAR-002.A1');
    expect(model.cases[0].description).not.toContain(req2.sourcePath);
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

  it('groupCasesByDomain buckets by area — same shape as before REQ-JIRAREG-002', () => {
    const grouped = groupCasesByDomain([
      { reqId: 'R1', criterionId: 'R1.A1', criterionText: 't', specPath: 's', tier: 'backend', domainArea: 'Uncategorised', areasAll: ['Uncategorised'], kind: 'executable' },
      { reqId: 'R1', criterionId: 'R1.A2', criterionText: 'u', specPath: 's', tier: 'backend', domainArea: 'Uncategorised', areasAll: ['Uncategorised'], kind: 'executable' },
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

  it('renderCaseSteps names the source criterion id but not the spec path (A3 + 004.A1)', () => {
    const body = renderCaseSteps({
      reqId: 'REQ-X-001',
      criterionId: 'REQ-X-001.A1',
      criterionText: 'It happens.',
      specPath: 'specs/x.md',
      tier: 'backend',
      domainArea: 'Uncategorised',
      areasAll: ['Uncategorised'],
      kind: 'executable',
    });
    expect(body).toContain('REQ-X-001.A1');
    expect(body).toContain('Source:');
    // REQ-JIRAREG-004.A1: no file path leaks into the black-box body.
    expect(body).not.toContain('specs/x.md');
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

// ---------------------------------------------------------------------------
// REQ-JIRAREG-002 — domain-organised, gaps surfaced, idempotent reorg
// ---------------------------------------------------------------------------

function makeDomain(id: string, title: string, dependsOn: string | string[]): Spec {
  return {
    id,
    kind: 'domain',
    title,
    body: title,
    format: 'markdown',
    sourcePath: `specs/domain/${id.toLowerCase()}.md`,
    contentHash: 'd-hash',
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    metadata: { depends_on: dependsOn },
  };
}

describe('computeDomainAreasByReqId — REQ-JIRAREG-002 (walk)', () => {
  it('finds a domain fact that directly depends_on the requirement', async () => {
const req = makeReq('REQ-DOM-001', 'Payments');
    const fact = makeDomain('DOMAIN-PAY', 'Payments', 'REQ-DOM-001');
    const sq = fakeQueries({ specs: [req, fact] });
    const idx = computeDomainAreasByReqId(sq);
    expect(idx.get('REQ-DOM-001')?.map((f) => f.id)).toEqual(['DOMAIN-PAY']);
  });

  it('reaches a requirement transitively through a chained domain fact', () => {
    // fact-detail depends_on fact-area; fact-area depends_on the requirement.
    // Both facts count as areas the requirement inherits — the 2-hop shape
    // the SpecLinkResolver walk supports (REQ-DOMAIN-002).
    const req = makeReq('REQ-CHAIN-001', 'Chain');
    const factArea = makeDomain('DOMAIN-AREA', 'Area', 'REQ-CHAIN-001');
    const factDetail = makeDomain('DOMAIN-DETAIL', 'Detail', 'DOMAIN-AREA');
    const sq = fakeQueries({ specs: [req, factArea, factDetail] });
    const idx = computeDomainAreasByReqId(sq);
    expect(idx.get('REQ-CHAIN-001')?.map((f) => f.id)).toEqual([
      'DOMAIN-AREA',
      'DOMAIN-DETAIL',
    ]);
  });

  it('is cycle-safe when specs depend on each other', () => {
    // Two facts point at each other AND at the requirement. Both facts govern
    // the requirement; the BFS must terminate and each (req, fact) pair
    // appears at most once.
    const req = makeReq('REQ-CYC-001', 'Cycle');
    const factA = makeDomain('DOMAIN-CA', 'A', ['DOMAIN-CB', 'REQ-CYC-001']);
    const factB = makeDomain('DOMAIN-CB', 'B', ['DOMAIN-CA']);
    const sq = fakeQueries({ specs: [req, factA, factB] });
    const idx = computeDomainAreasByReqId(sq);
    expect(idx.get('REQ-CYC-001')?.map((f) => f.id)).toEqual([
      'DOMAIN-CA',
      'DOMAIN-CB',
    ]);
  });

  it('records both facts when two domain facts point at the same requirement, sorted by id', async () => {
const req = makeReq('REQ-TWO-001', 'Two');
    const factZ = makeDomain('DOMAIN-Z', 'Zed', 'REQ-TWO-001');
    const factA = makeDomain('DOMAIN-A', 'Alpha', 'REQ-TWO-001');
    const sq = fakeQueries({ specs: [req, factZ, factA] });
    const idx = computeDomainAreasByReqId(sq);
    expect(idx.get('REQ-TWO-001')?.map((f) => f.id)).toEqual(['DOMAIN-A', 'DOMAIN-Z']);
  });
});

describe('buildRegressionPack — REQ-JIRAREG-002 (areas, cross-refs, gaps)', () => {
  it('A1 single domain fact: case files under that fact\'s area', () => {
    const req = makeReq('REQ-ONE-001', 'Only');
    const a1 = makeAcceptance('REQ-ONE-001.A1', req.id, 'A1 body.', req.sourcePath);
    const fact = makeDomain('DOMAIN-PAY', 'Payments', 'REQ-ONE-001');
    const sq = fakeQueries({
      specs: [req, a1, fact],
      linksBySpec: { [req.id]: [makeLink(req.id, 'implements', 'implemented')] },
    });
    const model = buildRegressionPack(sq);
    expect(model.cases).toHaveLength(1);
    expect(model.cases[0].kind).toBe('executable');
    expect(model.stories).toHaveLength(1);
    expect(model.stories[0].domainArea).toBe('Payments');
    expect(model.domainGaps).toEqual([]);
  });

  it('A1 two facts: one executable + one cross-ref, deterministic ordering', () => {
    const req = makeReq('REQ-TWO-001', 'Two');
    const a1 = makeAcceptance('REQ-TWO-001.A1', req.id, 'text.', req.sourcePath);
    // Titles that would sort A after B — proves we sort by ID, not title.
    const factA = makeDomain('DOMAIN-A', 'Zeta', 'REQ-TWO-001');
    const factB = makeDomain('DOMAIN-B', 'Alpha', 'REQ-TWO-001');
    const sq = fakeQueries({
      specs: [req, a1, factA, factB],
      linksBySpec: { [req.id]: [makeLink(req.id, 'implements', 'implemented')] },
    });
    const model = buildRegressionPack(sq);
    // Two case rows: executable under DOMAIN-A ('Zeta'), cross-ref under DOMAIN-B ('Alpha').
    expect(model.cases).toHaveLength(2);
    const exec = model.cases.find((c) => c.kind === 'executable')!;
    const xref = model.cases.find((c) => c.kind === 'crossref')!;
    expect(exec.criterionId).toBe('REQ-TWO-001.A1');
    expect(xref.criterionId).toBe('REQ-TWO-001.A1');
    expect(exec.label.startsWith(REG_PACK_CASE_LABEL_PREFIX)).toBe(true);
    expect(xref.label.startsWith('specship-regxref-')).toBe(true);
    // Cross-ref body points back at the executable area (Zeta = DOMAIN-A's title).
    expect(xref.description).toContain('Zeta');
  });

  it('A2 no domain link: case files under Uncategorised and a gap is reported', () => {
    const req = makeReq('REQ-GAP-001', 'Gap');
    const a1 = makeAcceptance('REQ-GAP-001.A1', req.id, 'x.', req.sourcePath);
    const sq = fakeQueries({
      specs: [req, a1],
      linksBySpec: { [req.id]: [makeLink(req.id, 'implements', 'implemented')] },
    });
    const model = buildRegressionPack(sq);
    expect(model.stories.map((s) => s.domainArea)).toEqual(['Uncategorised']);
    expect(model.domainGaps).toEqual([
      { reqId: 'REQ-GAP-001', specPath: req.sourcePath },
    ]);
    const report = renderDomainGapReport(model.domainGaps);
    expect(report).toContain('/specship:spec domain');
    expect(report).toContain('REQ-GAP-001');
  });
});

describe('upsertRegressionPack — REQ-JIRAREG-002 (idempotent reorg, xref idempotency)', () => {
  it('A3 moving a case from Uncategorised into a new area reparents in place — same key, no duplicate', async () => {
    const req = makeReq('REQ-MOVE-001', 'Move');
    const a1 = makeAcceptance('REQ-MOVE-001.A1', req.id, 'text.', req.sourcePath);
    // First run: no domain fact → Uncategorised.
    const sqBefore = fakeQueries({
      specs: [req, a1],
      linksBySpec: { [req.id]: [makeLink(req.id, 'implements', 'implemented')] },
    });
    const before = buildRegressionPack(sqBefore);
    const fake = makeFake();
    const first = await upsertRegressionPack(fake.client, before, { projectKey: 'PROJ' });
    const caseKey = first.caseKeysByCriterion['REQ-MOVE-001.A1'];
    expect(caseKey).toBeTruthy();
    const uncatStoryKey = fake.issues.get(caseKey)!.parentKey!;

    // Second run: add a domain fact → area is now "Payments".
    const fact = makeDomain('DOMAIN-PAY', 'Payments', 'REQ-MOVE-001');
    const sqAfter = fakeQueries({
      specs: [req, a1, fact],
      linksBySpec: { [req.id]: [makeLink(req.id, 'implements', 'implemented')] },
    });
    const after = buildRegressionPack(sqAfter);

    fake.created.length = 0;
    fake.updated.length = 0;
    fake.commentsAdded.length = 0;
    fake.labelsAdded.length = 0;
    const result = await upsertRegressionPack(fake.client, after, { projectKey: 'PROJ' });

    // Same case key — no duplicate.
    expect(result.caseKeysByCriterion['REQ-MOVE-001.A1']).toBe(caseKey);
    // Case's parent now points at the new Payments story (not the old Uncat one).
    const newParent = fake.issues.get(caseKey)!.parentKey!;
    expect(newParent).not.toBe(uncatStoryKey);
    expect(fake.issues.get(newParent)!.summary).toContain('Payments');
    // The case issue was updated (parent reassignment or body drift both count).
    expect(fake.updated).toContain(caseKey);
  });

  it('a second identical run does not rewrite the parent (parent no-op)', async () => {
    const req = makeReq('REQ-NOP-001', 'Nop');
    const a1 = makeAcceptance('REQ-NOP-001.A1', req.id, 'text.', req.sourcePath);
    const fact = makeDomain('DOMAIN-NOP', 'Nopland', 'REQ-NOP-001');
    const sq = fakeQueries({
      specs: [req, a1, fact],
      linksBySpec: { [req.id]: [makeLink(req.id, 'implements', 'implemented')] },
    });
    const model = buildRegressionPack(sq);
    const fake = makeFake();
    await upsertRegressionPack(fake.client, model, { projectKey: 'PROJ' });
    fake.created.length = 0;
    fake.updated.length = 0;
    const result = await upsertRegressionPack(fake.client, model, { projectKey: 'PROJ' });
    expect(result.casesUpdated).toBe(0);
    expect(result.casesSkipped).toBe(1);
    expect(fake.updated).toHaveLength(0);
  });

  it('cross-ref idempotency: a re-run with two facts skips the executable AND the cross-ref', async () => {
    const req = makeReq('REQ-XREF-001', 'Xref');
    const a1 = makeAcceptance('REQ-XREF-001.A1', req.id, 'text.', req.sourcePath);
    const factA = makeDomain('DOMAIN-A', 'A', 'REQ-XREF-001');
    const factB = makeDomain('DOMAIN-B', 'B', 'REQ-XREF-001');
    const sq = fakeQueries({
      specs: [req, a1, factA, factB],
      linksBySpec: { [req.id]: [makeLink(req.id, 'implements', 'implemented')] },
    });
    const model = buildRegressionPack(sq);
    const fake = makeFake();
    await upsertRegressionPack(fake.client, model, { projectKey: 'PROJ' });
    fake.created.length = 0;
    fake.updated.length = 0;
    const result = await upsertRegressionPack(fake.client, model, { projectKey: 'PROJ' });
    expect(result.casesCreated).toBe(0);
    expect(result.casesUpdated).toBe(0);
    expect(result.casesSkipped).toBe(1);
    expect(result.crossRefsCreated).toBe(0);
    expect(result.crossRefsUpdated).toBe(0);
    expect(result.crossRefsSkipped).toBe(1);
    expect(fake.created).toHaveLength(0);
    expect(fake.updated).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// REQ-JIRAREG-004 — black-box body, derived tier, rephrase flagging
// ---------------------------------------------------------------------------

import type { Node } from '../../src/types';
import {
  classifyCriterion,
  deriveCaseTier,
  renderRephraseReport,
  renderCrossReferenceBody,
  REG_PACK_TIER_LABEL_UI,
  REG_PACK_TIER_LABEL_BACKEND,
} from '../../src/jira/regression-pack';

function makeNode(id: string, kind: Node['kind'], filePath: string): Node {
  return {
    id,
    kind,
    name: id,
    qualifiedName: id,
    filePath,
    language: 'typescript',
    startLine: 1,
    endLine: 1,
    startColumn: 0,
    endColumn: 0,
  };
}

describe('REQ-JIRAREG-004.A1 — case body is black-box (no paths, no symbols, no spec ptr)', () => {
  function assertBlackBox(body: string): void {
    // No source paths of any flavour.
    expect(body).not.toMatch(/\bsrc\//);
    expect(body).not.toMatch(/\.tsx?\b/);
    expect(body).not.toMatch(/\.jsx?\b/);
    expect(body).not.toContain('specs/');
    // No inline traceability breadcrumb in the Steps block; the id lives only
    // under the Reference section.
    const stepsMatch = body.match(/Steps:\n([\s\S]*?)\n\nReference:/);
    expect(stepsMatch).not.toBeNull();
    const stepsSection = stepsMatch![1]!;
    expect(stepsSection).not.toContain('REQ-');
  }

  it('renderCaseSteps: Steps section has no code refs and no `- Spec:` line', () => {
    const body = renderCaseSteps({
      reqId: 'REQ-BB-001',
      criterionId: 'REQ-BB-001.A1',
      criterionText: 'The response shows the updated count.',
      specPath: 'src/foo/bar.ts',
      tier: 'backend',
      domainArea: 'Some Area',
      areasAll: ['Some Area'],
      kind: 'executable',
    });
    assertBlackBox(body);
    expect(body).toContain('Tier: backend');
    expect(body).toContain('Source: REQ-BB-001.A1');
  });

  it('renderCrossReferenceBody: same body invariants apply', () => {
    const body = renderCrossReferenceBody(
      {
        reqId: 'REQ-BB-002',
        criterionId: 'REQ-BB-002.A1',
        criterionText: 'The message is displayed.',
        specPath: 'src/x.ts',
        tier: 'ui',
        domainArea: 'Alt Area',
        areasAll: ['Primary', 'Alt Area'],
        kind: 'crossref',
      },
      'Primary',
    );
    expect(body).toContain('Tier: ui');
    expect(body).not.toMatch(/\bsrc\//);
    expect(body).not.toMatch(/\.tsx?\b/);
    expect(body).not.toContain('specs/');
    expect(body).toContain('Source: REQ-BB-002.A1');
  });
});

describe('REQ-JIRAREG-004.A2 — tier derives from behaviour surface', () => {
  it('(a) a requirement linked to a component node → tier `ui`', () => {
    const req = makeReq('REQ-UI-001', 'UI-linked');
    const acc = makeAcceptance('REQ-UI-001.A1', req.id, 'The screen shows a banner.', req.sourcePath);
    const componentNode = makeNode('n-comp', 'component', 'src/ui/Banner.tsx');
    const sq: BuilderSpecQueries = {
      ...fakeQueries({
        specs: [req, acc],
        linksBySpec: { [req.id]: [makeLink(req.id, 'implements', 'implemented')] },
      }),
      getLinkedNodesForReq: () => [componentNode],
      getNeighbourNodes: () => [],
    };
    expect(deriveCaseTier(req, sq)).toBe('ui');
    const model = buildRegressionPack(sq);
    expect(model.cases[0].tierLabel).toBe(REG_PACK_TIER_LABEL_UI);
  });

  it('(b) a requirement linked only to a backend function → tier `backend`', () => {
    const req = makeReq('REQ-BE-001', 'Backend-linked');
    const acc = makeAcceptance('REQ-BE-001.A1', req.id, 'The endpoint returns 200.', req.sourcePath);
    const fnNode = makeNode('n-fn', 'function', 'src/handlers/payments.ts');
    const sq: BuilderSpecQueries = {
      ...fakeQueries({
        specs: [req, acc],
        linksBySpec: { [req.id]: [makeLink(req.id, 'implements', 'implemented')] },
      }),
      getLinkedNodesForReq: () => [fnNode],
      getNeighbourNodes: () => [],
    };
    expect(deriveCaseTier(req, sq)).toBe('backend');
    const model = buildRegressionPack(sq);
    expect(model.cases[0].tierLabel).toBe(REG_PACK_TIER_LABEL_BACKEND);
  });

  it('(c) a requirement with no linked nodes → tier `backend` (never spurious ui)', () => {
    const req = makeReq('REQ-NL-001', 'No-link');
    const acc = makeAcceptance('REQ-NL-001.A1', req.id, 'The response contains a value.', req.sourcePath);
    const sq: BuilderSpecQueries = {
      ...fakeQueries({
        specs: [req, acc],
        linksBySpec: { [req.id]: [makeLink(req.id, 'implements', 'implemented')] },
      }),
      // No accessors present at all — mirrors a fixture / dry planner.
    };
    expect(deriveCaseTier(req, sq)).toBe('backend');
    const model = buildRegressionPack(sq);
    expect(model.cases[0].tierLabel).toBe(REG_PACK_TIER_LABEL_BACKEND);
  });
});

describe('REQ-JIRAREG-004.A3 — vague / code-leaking criteria are flagged', () => {
  it('vague criterion body ("system works correctly") lands in rephraseFlags', () => {
    const req = makeReq('REQ-VG-001', 'Vague');
    const acc = makeAcceptance('REQ-VG-001.A1', req.id, 'The system works correctly.', req.sourcePath);
    const sq = fakeQueries({
      specs: [req, acc],
      linksBySpec: { [req.id]: [makeLink(req.id, 'implements', 'implemented')] },
    });
    const model = buildRegressionPack(sq);
    expect(model.rephraseFlags).toHaveLength(1);
    expect(model.rephraseFlags[0].criterionId).toBe('REQ-VG-001.A1');
    expect(model.rephraseFlags[0].reason).toMatch(/observable/);
    // The case is still emitted — the pack stays complete; the flag drives
    // a human rephrase pass, not silent omission.
    expect(model.cases).toHaveLength(1);
    // The report renderer surfaces the flag with the id + reason.
    const report = renderRephraseReport(model.rephraseFlags);
    expect(report).toContain('REQ-VG-001.A1');
    expect(report).toContain('observable');
  });

  it('code-leaking criterion (names a src path / .ts extension / backticked symbol) is flagged', () => {
    expect(classifyCriterion('The response body matches src/foo.ts output.').reason).toMatch(/code/);
    expect(classifyCriterion('When `handlePayment` returns, the row updates.').reason).toMatch(/code/);
    expect(classifyCriterion('The response body is a `payments.ts` file.').reason).toMatch(/code/);
  });

  it('observable, black-box criterion is not flagged', () => {
    expect(classifyCriterion('The tester receives a 429 response after the 6th attempt.').observable).toBe(true);
    expect(classifyCriterion('The tester receives a 429 response after the 6th attempt.').reason).toBeUndefined();
  });

  it('renderRephraseReport is empty when no flags', () => {
    expect(renderRephraseReport([])).toBe('');
  });
});
