/**
 * REQ-JIRAREG-005 — the pack-run recorder: comment upsert per (case, runId),
 * validates-link feedback with jira:// targets, workflow transitions with
 * graceful skip, idempotency, and A3 unexecuted semantics.
 */
import { describe, it, expect } from 'vitest';
import type { Spec, SpecLink, SpecLinkState } from '../../src/types';
import {
  recordRunResult,
  finalizePackRun,
  summarizePackRun,
  type RunResultJiraClient,
  type RunResultSpecQueries,
} from '../../src/jira/regression-pack';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

function fakeClient(seed: Array<{ id: string; body: string }> = []) {
  const comments: Array<{ id: string; body: string }> = [...seed];
  const transitions: Array<{ key: string; name: string; result: string }> = [];
  const client: RunResultJiraClient = {
    async listCommentsDetailed(_key) {
      return comments.map((c) => ({ ...c }));
    },
    async addComment(_key, body) {
      const id = `c${comments.length + 1}`;
      comments.push({ id, body });
      return { id };
    },
    async updateComment(_key, id, body) {
      const i = comments.findIndex((c) => c.id === id);
      if (i === -1) throw new Error('no such comment');
      comments[i] = { id, body };
    },
    async transitionIssue(key, name) {
      // Graceful-skip when name is `SKIP` — used to prove the recorder honours
      // transitionIssue's own graceful-skip contract without hard-coding names.
      if (name === 'SKIP') {
        transitions.push({ key, name, result: 'skipped' });
        return { ok: true as const, skipped: name, reason: 'no such transition' };
      }
      transitions.push({ key, name, result: 'moved' });
      return { ok: true as const, transitioned: name };
    },
  };
  return { client, comments, transitions };
}

function fakeSpecQueries(spec: Spec) {
  const links: SpecLink[] = [];
  let nextId = 1;
  const sq: RunResultSpecQueries = {
    getSpecById: (id) => (id === spec.id ? spec : null),
    findLogicalLink: (specId, targetFilePath, targetQualifiedName, kind) =>
      links.find(
        (l) =>
          l.specId === specId &&
          l.targetFilePath === targetFilePath &&
          l.targetQualifiedName === targetQualifiedName &&
          l.kind === kind,
      ) ?? null,
    upsertSpecLink: (link) => {
      const id = nextId++;
      links.push({ ...link, id });
      return id;
    },
    updateSpecLinkState: (id, state, driftAxis, updatedAt) => {
      const l = links.find((x) => x.id === id);
      if (!l) return;
      l.state = state as SpecLinkState;
      if (driftAxis !== undefined) l.driftAxis = driftAxis;
      if (updatedAt !== undefined) l.updatedAt = updatedAt;
    },
  };
  return { sq, links };
}

const CRITERION: Spec = {
  id: 'REQ-FOO-001.A1',
  kind: 'acceptance',
  title: 'x',
  body: 'x',
  format: 'markdown',
  sourcePath: 'specs/foo.md',
  contentHash: 'hash-1',
  version: 1,
  createdAt: 1,
  updatedAt: 1,
};

// ---------------------------------------------------------------------------
// Pass path
// ---------------------------------------------------------------------------

describe('recordRunResult — pass path (REQ-JIRAREG-005.A1)', () => {
  it('posts a comment, transitions to Done, and upserts a verified validates-link', async () => {
    const { client, comments, transitions } = fakeClient();
    const { sq, links } = fakeSpecQueries(CRITERION);
    const out = await recordRunResult(
      { client, specQueries: sq, now: () => 1_700_000_000_000 },
      {
        caseKey: 'PROJ-42',
        criterionId: CRITERION.id,
        status: 'passed',
        executor: 'human',
        runId: 'run-1',
      },
    );
    expect(out.pending).toBe(false);
    expect(out.comment).toBe('created');
    expect(out.transition).toBe('moved');
    expect(out.linked).toBe(true);
    expect(comments).toHaveLength(1);
    expect(comments[0]!.body).toContain('passed');
    expect(comments[0]!.body).toContain('run-1');
    expect(transitions).toEqual([{ key: 'PROJ-42', name: 'Done', result: 'moved' }]);
    expect(links).toHaveLength(1);
    expect(links[0]!.kind).toBe('validates');
    expect(links[0]!.state).toBe('verified');
    expect(links[0]!.targetFilePath).toBe('jira://PROJ-42');
    expect(links[0]!.targetQualifiedName).toBe('PROJ-42');
  });
});

// ---------------------------------------------------------------------------
// Fail path — triage hand-off + broken state
// ---------------------------------------------------------------------------

describe('recordRunResult — fail path (REQ-JIRAREG-005.A3)', () => {
  it('embeds a triage hint, transitions to In Review, and marks validates broken', async () => {
    const { client, comments, transitions } = fakeClient();
    const { sq, links } = fakeSpecQueries(CRITERION);
    const out = await recordRunResult(
      { client, specQueries: sq },
      {
        caseKey: 'PROJ-99',
        criterionId: CRITERION.id,
        status: 'failed',
        executor: 'agent',
        harness: 'behaviour-e2e',
        runId: 'run-2',
        evidence: { error: 'assertion failed' },
      },
    );
    expect(out.triageHint).toContain('/specship:spec triage');
    expect(out.triageHint).toContain(CRITERION.id);
    expect(comments[0]!.body).toContain('/specship:spec triage');
    expect(transitions).toEqual([{ key: 'PROJ-99', name: 'In Review', result: 'moved' }]);
    expect(links[0]!.state).toBe('broken');
  });
});

// ---------------------------------------------------------------------------
// Unexecuted — A3: no state churn on the validates link, no transition
// ---------------------------------------------------------------------------

describe('recordRunResult — unexecuted (REQ-JIRAREG-005.A3)', () => {
  it('posts a comment but skips the transition AND leaves any existing link state UNTOUCHED', async () => {
    const { client, comments, transitions } = fakeClient();
    const { sq, links } = fakeSpecQueries(CRITERION);

    // Seed a prior verified link — a subsequent unexecuted record must NOT flip it.
    const pass = await recordRunResult(
      { client, specQueries: sq },
      { caseKey: 'PROJ-7', criterionId: CRITERION.id, status: 'passed', executor: 'human', runId: 'r-a' },
    );
    expect(pass.linked).toBe(true);
    expect(links[0]!.state).toBe('verified');

    const un = await recordRunResult(
      { client, specQueries: sq },
      { caseKey: 'PROJ-7', criterionId: CRITERION.id, status: 'unexecuted', executor: 'agent', runId: 'r-b' },
    );
    expect(un.transition).toBe('skipped');
    expect(un.linked).toBe(false);
    expect(links).toHaveLength(1);
    expect(links[0]!.state).toBe('verified'); // untouched
    // Comment for r-b landed.
    expect(comments.some((c) => c.body.includes('run r-b') || c.body.includes('r-b'))).toBe(true);
    // Only the pass triggered a transition attempt.
    expect(transitions).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Idempotency — (caseKey, runId) key edits in place, no duplicate link row
// ---------------------------------------------------------------------------

describe('recordRunResult — idempotency', () => {
  it('a second call with the same (caseKey, runId) edits the comment in place and does not duplicate the link', async () => {
    const { client, comments } = fakeClient();
    const { sq, links } = fakeSpecQueries(CRITERION);
    const first = await recordRunResult(
      { client, specQueries: sq },
      { caseKey: 'PROJ-1', criterionId: CRITERION.id, status: 'passed', executor: 'human', runId: 'same' },
    );
    expect(first.comment).toBe('created');
    const secondSame = await recordRunResult(
      { client, specQueries: sq },
      { caseKey: 'PROJ-1', criterionId: CRITERION.id, status: 'passed', executor: 'human', runId: 'same' },
    );
    expect(secondSame.comment).toBe('skipped');
    expect(comments).toHaveLength(1);
    expect(links).toHaveLength(1);

    // Same run, changing evidence body → edit-in-place, still one row.
    const evolved = await recordRunResult(
      { client, specQueries: sq },
      {
        caseKey: 'PROJ-1',
        criterionId: CRITERION.id,
        status: 'failed',
        executor: 'human',
        runId: 'same',
        evidence: { error: 'now failing' },
      },
    );
    expect(evolved.comment).toBe('updated');
    expect(comments).toHaveLength(1);
    expect(links).toHaveLength(1);
    expect(links[0]!.state).toBe('broken');
  });
});

// ---------------------------------------------------------------------------
// Executor parity — one result per case, whoever ran it
// ---------------------------------------------------------------------------

describe('recordRunResult — human/agent parity (REQ-JIRAREG-005.A2)', () => {
  it('an agent-executed harness case shapes the same as a human one — one comment, one link', async () => {
    const { client, comments } = fakeClient();
    const { sq, links } = fakeSpecQueries(CRITERION);
    await recordRunResult(
      { client, specQueries: sq },
      {
        caseKey: 'PROJ-5',
        criterionId: CRITERION.id,
        status: 'passed',
        executor: 'agent',
        harness: 'behaviour-e2e',
        runId: 'agent-run',
      },
    );
    expect(comments).toHaveLength(1);
    expect(comments[0]!.body).toContain('behaviour-e2e');
    expect(links).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Workflow transition graceful skip — never hard-fail
// ---------------------------------------------------------------------------

describe('recordRunResult — graceful transition skip', () => {
  it('honours transitionIssue graceful skip (no such transition on this workflow)', async () => {
    const { client } = fakeClient();
    const { sq } = fakeSpecQueries(CRITERION);
    const out = await recordRunResult(
      { client, specQueries: sq, transitions: { passed: 'SKIP', failed: 'SKIP' } },
      { caseKey: 'PROJ-3', criterionId: CRITERION.id, status: 'passed', executor: 'human', runId: 'r-skip' },
    );
    expect(out.transition).toBe('skipped');
    // Comment + link still land — the transition skip must never block them.
    expect(out.comment).toBe('created');
    expect(out.linked).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// finalizePackRun (REQ-JIRAREG-005.A4)
// ---------------------------------------------------------------------------

describe('finalizePackRun — summary comment (REQ-JIRAREG-005.A4)', () => {
  it('summarizes counts + triage list, upserts a single comment on the epic', async () => {
    const { client, comments } = fakeClient();
    const results = [
      { caseKey: 'PROJ-1', criterionId: 'REQ-X.A1', status: 'passed' as const, executor: 'human' as const, runId: 'r1' },
      { caseKey: 'PROJ-2', criterionId: 'REQ-X.A2', status: 'failed' as const, executor: 'human' as const, runId: 'r1' },
      { caseKey: 'PROJ-3', criterionId: 'REQ-X.A3', status: 'unexecuted' as const, executor: 'agent' as const, runId: 'r1' },
    ];
    const ev = summarizePackRun({ runId: 'r1', results });
    expect(ev).toMatchObject({ executed: 2, passed: 1, failed: 1, unexecuted: 1, obsolete: 0 });
    expect(ev.triageCriterionIds).toEqual(['REQ-X.A2']);

    const first = await finalizePackRun(client, 'PROJ-EPIC', { runId: 'r1', results });
    expect(first.status).toBe('created');
    expect(comments).toHaveLength(1);
    expect(comments[0]!.body).toContain('| 2 | 1 | 1 | 1 | 0 |');
    expect(comments[0]!.body).toContain('REQ-X.A2');

    // A second run with different counts must EDIT the same comment, not append.
    const results2 = [
      { caseKey: 'PROJ-1', criterionId: 'REQ-X.A1', status: 'passed' as const, executor: 'human' as const, runId: 'r2' },
    ];
    const second = await finalizePackRun(client, 'PROJ-EPIC', { runId: 'r2', results: results2 });
    expect(second.status).toBe('updated');
    expect(comments).toHaveLength(1);
    expect(comments[0]!.body).toContain('r2');
    expect(comments[0]!.body).not.toContain('| 2 |');
  });
});
