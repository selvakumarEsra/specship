/**
 * MEMLESSON-DOC (specs/lessons-memory.md) — capture lessons to memory.
 *
 * REQ-MEMLESSON-001: an explicit lesson-capture door produces a human-gated
 * `memory_rule` proposal targeting a portable ~/.claude memory note (default)
 * or a marked block in the project CLAUDE.md — nothing on disk until applied,
 * deduped by content hash, empty content refused.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DatabaseConnection } from '../src/db';
import { SqliteDatabase } from '../src/db/sqlite-adapter';
import {
  captureLesson,
  previewProposal,
  applyProposal,
  undoProposal,
  ReflectStore,
  ReflectContext,
} from '../src/reflect';
import type { Proposal } from '../src/reflect/types';

let dir: string;
let conn: DatabaseConnection;
let db: SqliteDatabase;
let ctx: ReflectContext;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'specship-memlesson-'));
  conn = DatabaseConnection.initialize(path.join(dir, 'test.db'));
  db = conn.getDb();
  fs.mkdirSync(path.join(dir, 'home'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'proj'), { recursive: true });
  ctx = { projectRoot: path.join(dir, 'proj'), homeDir: path.join(dir, 'home') };
});

afterEach(() => {
  try { conn.close(); } catch { /* ignore */ }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
});

/** @verifies REQ-MEMLESSON-001 */
const LESSON = 'The verify leg false-fails on a fresh worktree; always run tests under node 24.';

describe('REQ-MEMLESSON-001 — capture a lesson as a human-gated memory rule', () => {
  it('A1: a portable capture creates an open memory_rule proposal targeting a ~/.claude memory note, writing nothing', () => {
    const p = captureLesson(db, ctx, { title: 'Verify needs node 24', content: LESSON, scope: 'portable' });

    expect(p.type).toBe('memory_rule');
    expect(p.targetKind).toBe('memory_note');
    expect(p.state).toBe('open');
    // Target is under ~/.claude/memory, not the project.
    expect(p.targetPath.startsWith(path.join(ctx.homeDir, '.claude', 'memory'))).toBe(true);

    // Preview shows the note + index line apply would write; nothing on disk yet.
    const prev = previewProposal(p);
    expect(prev.after).toContain(LESSON);
    expect(fs.existsSync(p.targetPath)).toBe(false);
    // MEMORY.md index line is part of the memory_note payload.
    if (p.payload.kind === 'memory_note') {
      expect(p.payload.indexLine).toMatch(/Verify needs node 24/);
    } else {
      throw new Error('expected a memory_note payload');
    }
  });

  it('A2: a claude-md capture targets a marked block in the project CLAUDE.md', () => {
    const p = captureLesson(db, ctx, { title: 'Verify needs node 24', content: LESSON, scope: 'project' });
    expect(p.type).toBe('memory_rule');
    expect(p.targetKind).toBe('claude_md');
    expect(p.targetPath).toBe(path.join(ctx.projectRoot, 'CLAUDE.md'));
    const prev = previewProposal(p);
    expect(prev.after).toContain(LESSON);
    expect(prev.after).toMatch(/SPECSHIP_LEARNING/); // marked block
  });

  it('A3: applying the proposal writes the note idempotently', () => {
    const p = captureLesson(db, ctx, { title: 'Verify needs node 24', content: LESSON, scope: 'portable' });
    const first = applyProposal(p, ctx.homeDir);
    expect(first).toBe('applied');
    expect(fs.existsSync(p.targetPath)).toBe(true);
    expect(fs.readFileSync(p.targetPath, 'utf-8')).toContain(LESSON);
    // Re-apply is a no-op (unchanged).
    expect(applyProposal(p, ctx.homeDir)).toBe('unchanged');
  });

  it('A4: re-capturing the same lesson converges to one proposal, not a duplicate', () => {
    const p1 = captureLesson(db, ctx, { title: 'Verify needs node 24', content: LESSON, scope: 'portable' });
    const p2 = captureLesson(db, ctx, { title: 'Verify needs node 24', content: LESSON, scope: 'portable' });
    expect(p2.contentHash).toBe(p1.contentHash);
    const all = new ReflectStore(db).list().filter((x) => x.type === 'memory_rule');
    expect(all).toHaveLength(1);
  });

  it('portable and claude-md targets are distinct proposals (different target → different hash)', () => {
    const a = captureLesson(db, ctx, { title: 'T', content: LESSON, scope: 'portable' });
    const b = captureLesson(db, ctx, { title: 'T', content: LESSON, scope: 'project' });
    expect(a.contentHash).not.toBe(b.contentHash);
    expect(new ReflectStore(db).list().filter((x) => x.type === 'memory_rule')).toHaveLength(2);
  });
});

/**
 * Capture a lesson, write it to disk, and mark it applied in the store — the
 * exact composition the `specship memory list`/`remove`/`edit` CLI performs.
 * @verifies REQ-MEMLESSON-002
 */
function applyAndStore(title: string, content: string, scope: 'portable' | 'project'): Proposal {
  const p = captureLesson(db, ctx, { title, content, scope });
  applyProposal(p, ctx.homeDir);
  new ReflectStore(db).setState(p.contentHash, 'applied');
  return p;
}

describe('REQ-MEMLESSON-002 — review the stored memory items', () => {
  it('A1: applied memory-rule lessons appear in the reflect-managed list, labeled by target', () => {
    applyAndStore('Note lesson', LESSON, 'portable');
    applyAndStore('MD lesson', 'Always X before Y.', 'project');
    const items = new ReflectStore(db).list('applied').filter((p) => p.type === 'memory_rule');
    expect(items).toHaveLength(2);
    expect(items.some((p) => p.targetKind === 'memory_note')).toBe(true);
    expect(items.some((p) => p.targetKind === 'claude_md')).toBe(true);
  });
  it('A2: an empty store lists nothing (reported cleanly, not an error)', () => {
    expect(new ReflectStore(db).list('applied').filter((p) => p.type === 'memory_rule')).toEqual([]);
  });
});

/** @verifies REQ-MEMLESSON-003 */
function removeApplied(p: Proposal): string {
  return undoProposal(p, ctx.homeDir);
}

describe('REQ-MEMLESSON-003 — remove or update a stored memory item', () => {
  it('A1: removing an applied memory note strips exactly the note file', () => {
    const p = applyAndStore('Removable', LESSON, 'portable');
    expect(fs.existsSync(p.targetPath)).toBe(true);
    expect(removeApplied(p)).toBe('undone');
    expect(fs.existsSync(p.targetPath)).toBe(false);
  });

  it('A1: removing an applied CLAUDE.md rule strips only its marked block, leaving surrounding content', () => {
    const mdPath = path.join(ctx.projectRoot, 'CLAUDE.md');
    fs.writeFileSync(mdPath, '# Keep me\n\nSurrounding content.\n');
    const p = applyAndStore('MD rule', 'Rule body here.', 'project');
    expect(fs.readFileSync(mdPath, 'utf-8')).toContain('Rule body here.');
    removeApplied(p);
    const after = fs.readFileSync(mdPath, 'utf-8');
    expect(after).toContain('# Keep me');
    expect(after).toContain('Surrounding content.');
    expect(after).not.toContain('Rule body here.');
  });

  it('A2: update (remove old + apply new) converges to the new body on disk', () => {
    const oldP = applyAndStore('Evolving', 'Old body.', 'portable');
    const next = captureLesson(db, ctx, { title: 'Evolving', content: 'New body.', scope: 'portable' });
    undoProposal(oldP, ctx.homeDir);
    expect(applyProposal(next, ctx.homeDir)).toBe('applied');
    const body = fs.readFileSync(next.targetPath, 'utf-8');
    expect(body).toContain('New body.');
    expect(body).not.toContain('Old body.');
  });

  it('A4: a non-existent item resolves to null (CLI reports "not found", writes nothing)', () => {
    expect(new ReflectStore(db).get('deadbeefdeadbeef')).toBeNull();
  });
});
