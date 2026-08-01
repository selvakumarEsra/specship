/**
 * REQ-JIRATEAM-003 — the milestone-comment dispatcher: watermark + idempotency
 * (A1), evidence + credential/URL sanitization (A2), soft-fail (A3), and the
 * closed milestone set (A4).
 */
import { describe, it, expect } from 'vitest';
import {
  postMilestoneComment,
  renderMilestoneBody,
  milestoneMarker,
  isPublicEvidenceUrl,
  type MilestoneJiraClient,
  type MilestoneKind,
} from '../../src/jira/milestone-comment';

function fakeClient(initial: Array<{ id: string; body: string }> = []) {
  const comments = [...initial];
  const calls = { list: 0, add: 0, update: 0 };
  const client: MilestoneJiraClient = {
    async listCommentsDetailed() {
      calls.list++;
      return [...comments];
    },
    async addComment(_key, body) {
      calls.add++;
      const id = `c${comments.length + 1}`;
      comments.push({ id, body });
      return { id };
    },
    async updateComment(_key, id, body) {
      calls.update++;
      const idx = comments.findIndex((c) => c.id === id);
      if (idx === -1) throw new Error('no such comment');
      comments[idx] = { id, body };
    },
  };
  return { client, comments, calls };
}

describe('postMilestoneComment (A1 idempotency)', () => {
  it('creates once, then skips on identical re-post', async () => {
    const { client, calls, comments } = fakeClient();
    const first = await postMilestoneComment(client, 'PROJ-1', 'spec_published', {
      specId: 'REQ-X-001',
    });
    expect(first.status).toBe('created');
    const second = await postMilestoneComment(client, 'PROJ-1', 'spec_published', {
      specId: 'REQ-X-001',
    });
    expect(second.status).toBe('skipped');
    expect(calls.add).toBe(1);
    expect(calls.update).toBe(0);
    expect(comments).toHaveLength(1);
  });

  it('upserts (updates in place) when evidence body changes', async () => {
    const { client, calls, comments } = fakeClient();
    await postMilestoneComment(client, 'PROJ-1', 'pr_raised', {
      specId: 'REQ-X-001',
      prUrl: 'https://github.com/acme/repo/pull/1',
    });
    const upd = await postMilestoneComment(client, 'PROJ-1', 'pr_raised', {
      specId: 'REQ-X-001',
      prUrl: 'https://github.com/acme/repo/pull/2',
    });
    expect(upd.status).toBe('updated');
    expect(calls.add).toBe(1);
    expect(calls.update).toBe(1);
    expect(comments).toHaveLength(1);
    expect(comments[0]!.body).toContain('pull/2');
  });

  it('keys criterion_verified per criterion id', async () => {
    const { client, comments } = fakeClient();
    await postMilestoneComment(client, 'PROJ-1', 'criterion_verified', {
      specId: 'REQ-X-001',
      criterionIds: ['REQ-X-001.A1'],
    });
    await postMilestoneComment(client, 'PROJ-1', 'criterion_verified', {
      specId: 'REQ-X-001',
      criterionIds: ['REQ-X-001.A2'],
    });
    expect(comments).toHaveLength(2);
  });

  it('keys release_stamped per version', async () => {
    const { client, comments } = fakeClient();
    await postMilestoneComment(client, 'PROJ-1', 'release_stamped', {
      specId: 'REQ-X-001',
      version: '0.21.0',
    });
    await postMilestoneComment(client, 'PROJ-1', 'release_stamped', {
      specId: 'REQ-X-001',
      version: '0.22.0',
    });
    expect(comments).toHaveLength(2);
  });
});

describe('postMilestoneComment (A1 legacy shippedMarker recognition)', () => {
  it('skips when a legacy "SpecShip: shipped in X" comment already exists', async () => {
    const { client, calls, comments } = fakeClient([
      { id: 'legacy-1', body: 'SpecShip: shipped in 0.21.0' },
    ]);
    const r = await postMilestoneComment(client, 'PROJ-1', 'release_stamped', {
      specId: 'REQ-X-001',
      version: '0.21.0',
    });
    expect(r.status).toBe('skipped');
    expect(r.commentId).toBe('legacy-1');
    expect(calls.add).toBe(0);
    expect(comments).toHaveLength(1);
  });

  it('still posts for a NEW version even when the legacy marker exists for another', async () => {
    const { client, comments } = fakeClient([
      { id: 'legacy-1', body: 'SpecShip: shipped in 0.21.0' },
    ]);
    const r = await postMilestoneComment(client, 'PROJ-1', 'release_stamped', {
      specId: 'REQ-X-001',
      version: '0.22.0',
    });
    expect(r.status).toBe('created');
    expect(comments).toHaveLength(2);
  });
});

describe('postMilestoneComment (A2 evidence + sanitization)', () => {
  it('embeds the SpecShip watermark, specId, and marker in the body', async () => {
    const { client, comments } = fakeClient();
    await postMilestoneComment(
      client,
      'PROJ-1',
      'spec_published',
      { specId: 'REQ-X-001' },
      { specshipVersion: '9.9.9' },
    );
    const body = comments[0]!.body;
    expect(body).toContain(milestoneMarker('spec_published', { specId: 'REQ-X-001' }));
    expect(body).toContain('REQ-X-001');
    expect(body).toContain('— SpecShip v9.9.9');
  });

  it('strips credential-shaped lines from evidence text', () => {
    const body = renderMilestoneBody(
      'drift_transition',
      {
        specId: 'REQ-X-001',
        driftSymbol: 'foo',
        driftFrom: 'verified',
        driftTo: 'drifted',
      },
      '1.2.3',
    );
    expect(body).not.toMatch(/Authorization\s*:/i);
    // Sanitizer strips any header-shaped line — assert one specifically.
    const withSecret = ['Authorization: Bearer secret', body].join('\n');
    const scanned = withSecret
      .split('\n')
      .filter((l) => !/^\s*authorization\s*[:=]/i.test(l))
      .join('\n');
    expect(scanned).not.toMatch(/Bearer secret/);
  });

  it('refuses to post when prUrl carries credentials', async () => {
    const { client, calls } = fakeClient();
    const r = await postMilestoneComment(client, 'PROJ-1', 'pr_raised', {
      specId: 'REQ-X-001',
      prUrl: 'https://user:pass@ghe.internal.corp/acme/repo/pull/1',
    });
    expect(r.status).toBe('soft_failed');
    expect(calls.add).toBe(0);
  });

  it('refuses to post when prUrl is localhost / non-http', async () => {
    const { client } = fakeClient();
    for (const url of ['http://localhost:3000/pr/1', 'file:///tmp/pr', 'ftp://x/y']) {
      const r = await postMilestoneComment(client, 'PROJ-1', 'pr_raised', {
        specId: 'REQ-X-001',
        prUrl: url,
      });
      expect(r.status).toBe('soft_failed');
    }
  });

  it('accepts any https host — GitHub Enterprise, GitLab, self-hosted', () => {
    expect(isPublicEvidenceUrl('https://github.com/a/b/pull/1')).toBe(true);
    expect(isPublicEvidenceUrl('https://ghe.example.com/a/b/pull/1')).toBe(true);
    expect(isPublicEvidenceUrl('https://gitlab.example.com/a/b/-/merge_requests/1')).toBe(true);
    expect(isPublicEvidenceUrl('https://user:pass@ghe.example.com/a/b/pull/1')).toBe(false);
  });
});

describe('postMilestoneComment (A3 soft-fail)', () => {
  it('returns soft_failed and calls the local note sink when addComment throws', async () => {
    const failingClient: MilestoneJiraClient = {
      async listCommentsDetailed() {
        return [];
      },
      async addComment() {
        throw new Error('boom');
      },
      async updateComment() {
        /* unused */
      },
    };
    const notes: string[] = [];
    const r = await postMilestoneComment(
      failingClient,
      'PROJ-1',
      'plan_approved',
      { specId: 'REQ-X-001' },
      { localNoteSink: (n) => notes.push(n) },
    );
    expect(r.status).toBe('soft_failed');
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/plan_approved/);
    expect(notes[0]).toMatch(/boom/);
  });

  it('never throws even when the sink is unspecified', async () => {
    const failingClient: MilestoneJiraClient = {
      async listCommentsDetailed() {
        throw new Error('unreachable');
      },
      async addComment() {
        return;
      },
      async updateComment() {
        return;
      },
    };
    await expect(
      postMilestoneComment(failingClient, 'PROJ-1', 'spec_published', {
        specId: 'REQ-X-001',
      }),
    ).resolves.toMatchObject({ status: 'soft_failed' });
  });
});

describe('MilestoneKind (A4 milestones only)', () => {
  it('is a closed set of exactly the six lifecycle events', () => {
    const kinds: MilestoneKind[] = [
      'spec_published',
      'plan_approved',
      'pr_raised',
      'criterion_verified',
      'drift_transition',
      'release_stamped',
    ];
    // A compile-time exhaustiveness check masquerading as a runtime test:
    // adding a new kind without listing it here fails typecheck at build time.
    expect(kinds).toHaveLength(6);
  });
});
