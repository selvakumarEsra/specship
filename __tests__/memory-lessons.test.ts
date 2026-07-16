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
  ReflectStore,
  ReflectContext,
} from '../src/reflect';

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
