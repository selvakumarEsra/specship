/**
 * REQ-JIRATEAM-004 A3/A4 — the coverage post path is a single edit-in-place
 * watermarked comment; nothing writes to JIRA unless `post` is set.
 */
import { describe, it, expect } from 'vitest';
import {
  upsertWatermarkedComment,
  type WatermarkedCommentJiraClient,
} from '../../src/jira/publish';

const WATERMARK = '<!-- specship:coverage v1 -->';

function fakeClient(initial: Array<{ id: string; body: string }>) {
  const comments = [...initial];
  const calls = { list: 0, add: 0, update: 0 };
  const client: WatermarkedCommentJiraClient = {
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

describe('upsertWatermarkedComment (REQ-JIRATEAM-004.A3)', () => {
  it('creates a new comment when none carries the watermark', async () => {
    const { client, comments, calls } = fakeClient([
      { id: 'c-other', body: 'a manual comment' },
    ]);
    const res = await upsertWatermarkedComment(
      client,
      'PROJ-1',
      WATERMARK,
      `${WATERMARK}\nfirst body`,
    );
    expect(res.action).toBe('created');
    expect(calls.add).toBe(1);
    expect(calls.update).toBe(0);
    expect(comments.filter((c) => c.body.startsWith(WATERMARK))).toHaveLength(1);
  });

  it('updates the existing watermarked comment in place on re-post', async () => {
    const { client, comments, calls } = fakeClient([
      { id: 'c-existing', body: `${WATERMARK}\nold body` },
      { id: 'c-other', body: 'unrelated' },
    ]);
    const res = await upsertWatermarkedComment(
      client,
      'PROJ-1',
      WATERMARK,
      `${WATERMARK}\nnew body`,
    );
    expect(res.action).toBe('updated');
    expect(res.commentId).toBe('c-existing');
    expect(calls.add).toBe(0);
    expect(calls.update).toBe(1);
    // Exactly one watermarked comment survives — no duplication.
    const watermarked = comments.filter((c) => c.body.startsWith(WATERMARK));
    expect(watermarked).toHaveLength(1);
    expect(watermarked[0].body).toContain('new body');
  });

  it('running twice keeps a single watermarked comment (single-comment discipline)', async () => {
    const { client, comments } = fakeClient([]);
    await upsertWatermarkedComment(client, 'PROJ-1', WATERMARK, `${WATERMARK}\nv1`);
    await upsertWatermarkedComment(client, 'PROJ-1', WATERMARK, `${WATERMARK}\nv2`);
    const watermarked = comments.filter((c) => c.body.startsWith(WATERMARK));
    expect(watermarked).toHaveLength(1);
    expect(watermarked[0].body).toContain('v2');
  });
});
