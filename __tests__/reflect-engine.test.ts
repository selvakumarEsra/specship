/**
 * Reflection engine tests (REFLECT-DOC).
 *
 * Covers the miner (typed proposals + empty state), stable hashing, target
 * classification, the persisted store's state machine + new-vs-seen tracking,
 * and the apply/preview/undo pipeline's idempotency, reversibility, and conflict
 * refusal. Apply tests drive the pure functions with a TEMP homeDir/projectRoot
 * so they never touch the real ~/.claude.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DatabaseConnection } from '../src/db';
import { SqliteDatabase } from '../src/db/sqlite-adapter';
import {
  mineProposals,
  buildProposal,
  ReflectStore,
  previewProposal,
  applyProposal,
  undoProposal,
  ReflectContext,
} from '../src/reflect';

let dir: string;
let conn: DatabaseConnection;
let db: SqliteDatabase;
let ctx: ReflectContext;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'specship-reflect-'));
  conn = DatabaseConnection.initialize(path.join(dir, 'test.db'));
  db = conn.getDb();
  fs.mkdirSync(path.join(dir, 'home', '.claude', 'memory'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'proj'), { recursive: true });
  ctx = { projectRoot: path.join(dir, 'proj'), homeDir: path.join(dir, 'home') };
});

afterEach(() => {
  try { conn.close(); } catch { /* ignore */ }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
});

// --- seed helpers ---

let promptSeq = 0;
let callSeq = 0;
function seedSession(id: string): void {
  db.prepare(`INSERT OR IGNORE INTO claude_projects (path, name, first_seen, last_seen) VALUES (?,?,?,?)`)
    .run('/p', 'p', 1, 1);
  db.prepare(
    `INSERT OR IGNORE INTO claude_sessions (id, project_path, source_file, started_at, prompt_count) VALUES (?,?,?,?,?)`,
  ).run(id, '/p', 'f.jsonl', 1, 0);
}
function seedPrompt(sessionId: string, text: string): string {
  const id = `pr-${promptSeq++}`;
  db.prepare(`INSERT INTO claude_prompts (id, session_id, text, ts, is_sidechain) VALUES (?,?,?,?,0)`)
    .run(id, sessionId, text, promptSeq);
  return id;
}
function seedTool(sessionId: string, promptId: string, tool: string, summary: string): void {
  db.prepare(
    `INSERT INTO claude_tool_calls (prompt_id, session_id, assistant_uuid, tool_name, input_summary, ts)
     VALUES (?,?,?,?,?,?)`,
  ).run(promptId, sessionId, `a-${callSeq++}`, tool, summary, callSeq);
}

describe('reflect miner', () => {
  it('returns no proposals for an empty corpus (REQ-REFLECT-001.A2)', () => {
    expect(mineProposals(db, ctx)).toEqual([]);
  });

  it('proposes a project CLAUDE.md rule for repeated reads of one file (R1 → memory_rule)', () => {
    seedSession('s1');
    const p = seedPrompt('s1', 'work');
    for (let i = 0; i < 11; i++) seedTool('s1', p, 'Read', 'src/big-file.ts');
    const props = mineProposals(db, ctx);
    const r1 = props.find((x) => x.type === 'memory_rule' && x.targetKind === 'claude_md');
    expect(r1).toBeTruthy();
    expect(r1!.targetPath).toBe(path.join(ctx.projectRoot, 'CLAUDE.md'));
    expect(r1!.evidence.sessions).toContain('s1');
    expect(r1!.evidence.detail).toMatch(/× 11/);
  });

  it('proposes a portable memory note for a grep/find habit (R2 → memory_note)', () => {
    seedSession('s1');
    const p = seedPrompt('s1', 'work');
    for (let i = 0; i < 13; i++) seedTool('s1', p, 'Bash', `grep -r foo${i} .`);
    const props = mineProposals(db, ctx);
    const r2 = props.find((x) => x.type === 'memory_rule' && x.targetKind === 'memory_note');
    expect(r2).toBeTruthy();
    expect(r2!.targetPath).toBe(path.join(ctx.homeDir, '.claude', 'memory', 'prefer-specship-search-over-grep.md'));
  });

  it('proposes a skill for a repeated identical ask (R3 → command)', () => {
    seedSession('s1');
    for (let i = 0; i < 4; i++) seedPrompt('s1', 'run the full regression suite please');
    const props = mineProposals(db, ctx);
    const r3 = props.find((x) => x.type === 'skill');
    expect(r3).toBeTruthy();
    expect(r3!.targetKind).toBe('command');
    expect(r3!.targetPath).toMatch(/commands\/ss-.*\.md$/);
  });

  it('proposes a hook for a command repeated across sessions (R4 → settings_hook)', () => {
    for (const s of ['s1', 's2']) {
      seedSession(s);
      const p = seedPrompt(s, 'work');
      for (let i = 0; i < 3; i++) seedTool(s, p, 'Bash', 'npm test');
    }
    const props = mineProposals(db, ctx);
    const r4 = props.find((x) => x.type === 'hook');
    expect(r4).toBeTruthy();
    expect(r4!.targetKind).toBe('settings_hook');
    expect(r4!.targetPath).toBe(path.join(ctx.projectRoot, '.claude', 'settings.json'));
  });
});

describe('proposal hashing (REQ-REFLECT-007.A1)', () => {
  it('is stable across runs and independent of evidence', () => {
    const make = (sessions: string[]) =>
      buildProposal(ctx, {
        type: 'memory_rule',
        scope: 'project',
        severity: 'high',
        nameSeed: 'foo.ts',
        title: 'Prefer specship_explore over re-reading foo.ts',
        body: 'b',
        content: 'c',
        evidence: { sessions, prompts: [], detail: 'd' },
      });
    expect(make(['s1']).contentHash).toBe(make(['s2', 's3']).contentHash);
  });
});

describe('reflect store (REQ-REFLECT-007)', () => {
  function aProposal() {
    return buildProposal(ctx, {
      type: 'memory_rule', scope: 'project', severity: 'high', nameSeed: 'x.ts',
      title: 'rule x', body: 'b', content: 'c',
      evidence: { sessions: ['s1'], prompts: [], detail: 'd' },
    });
  }

  it('inserts on first sight and reports nothing new on re-mine', () => {
    const store = new ReflectStore(db);
    const p = aProposal();
    const first = store.upsertMined([p]);
    expect(first.insertedHashes.has(p.contentHash)).toBe(true);
    const second = store.upsertMined([p]);
    expect(second.insertedHashes.size).toBe(0);
  });

  it('preserves a dismissed state across re-mining (REQ-REFLECT-007.A2)', () => {
    const store = new ReflectStore(db);
    const p = aProposal();
    store.upsertMined([p]);
    store.setState(p.contentHash, 'dismissed');
    store.upsertMined([p]); // re-mine the same pattern
    expect(store.list('open').map((x) => x.contentHash)).not.toContain(p.contentHash);
    expect(store.get(p.contentHash)!.state).toBe('dismissed');
  });

  it('stamps applied_at on first apply only', () => {
    let t = 1000;
    const store = new ReflectStore(db, () => t);
    const p = aProposal();
    store.upsertMined([p]);
    t = 2000; store.setState(p.contentHash, 'applied');
    const a1 = store.get(p.contentHash)!.appliedAt;
    t = 3000; store.setState(p.contentHash, 'applied');
    expect(store.get(p.contentHash)!.appliedAt).toBe(a1);
  });
});

describe('apply / preview / undo (REQ-REFLECT-003 / 004)', () => {
  function claudeMdProposal() {
    return buildProposal(ctx, {
      type: 'memory_rule', scope: 'project', severity: 'high', nameSeed: 'foo.ts',
      title: 'Prefer specship_explore over re-reading foo.ts', body: 'b',
      content: 'Use specship_explore for foo.ts.',
      evidence: { sessions: ['s1'], prompts: [], detail: 'd' },
    });
  }
  function memoryNoteProposal() {
    return buildProposal(ctx, {
      type: 'memory_rule', scope: 'portable', severity: 'warn', nameSeed: 'prefer-search',
      title: 'Prefer specship_search', body: 'habit', content: 'Use specship_search.',
      evidence: { sessions: [], prompts: [], detail: 'd' },
    });
  }
  function hookProposal() {
    return buildProposal(ctx, {
      type: 'hook', severity: 'info', nameSeed: 'npm test',
      title: 'Automate npm test', body: 'b', content: 'npm test',
      hook: { event: 'PostToolUse', matcher: 'Edit|Write', command: 'npm test' },
      evidence: { sessions: [], prompts: [], detail: 'd' },
    });
  }

  it('preview does not write to disk (REQ-REFLECT-003.A1)', () => {
    const p = claudeMdProposal();
    const pre = previewProposal(p);
    expect(pre.before).toBe('');
    expect(pre.after).toContain('SPECSHIP_LEARNING');
    expect(fs.existsSync(p.targetPath)).toBe(false);
  });

  it('applies a CLAUDE.md rule idempotently and undoes it cleanly (REQ-REFLECT-004.A2/A3)', () => {
    const p = claudeMdProposal();
    // surrounding user content must survive.
    fs.writeFileSync(p.targetPath, '# My project\n\nHand-written notes.\n');
    expect(applyProposal(p, ctx.homeDir)).toBe('applied');
    expect(applyProposal(p, ctx.homeDir)).toBe('unchanged');
    const after = fs.readFileSync(p.targetPath, 'utf-8');
    expect(after).toContain('Hand-written notes.');
    expect(after).toContain('SPECSHIP_LEARNING');
    expect(undoProposal(p, ctx.homeDir)).toBe('undone');
    const restored = fs.readFileSync(p.targetPath, 'utf-8');
    expect(restored).toContain('Hand-written notes.');
    expect(restored).not.toContain('SPECSHIP_LEARNING');
  });

  it('writes a memory note + MEMORY.md line and removes both on undo', () => {
    const p = memoryNoteProposal();
    expect(applyProposal(p, ctx.homeDir)).toBe('applied');
    expect(fs.existsSync(p.targetPath)).toBe(true);
    const index = path.join(ctx.homeDir, '.claude', 'memory', 'MEMORY.md');
    expect(fs.readFileSync(index, 'utf-8')).toContain('Prefer specship_search');
    expect(applyProposal(p, ctx.homeDir)).toBe('unchanged');
    expect(undoProposal(p, ctx.homeDir)).toBe('undone');
    expect(fs.existsSync(p.targetPath)).toBe(false);
    expect(fs.readFileSync(index, 'utf-8')).not.toContain('Prefer specship_search');
  });

  it('refuses to clobber a non-SpecShip file at the target path (REQ-REFLECT-004.A4)', () => {
    const p = memoryNoteProposal();
    fs.writeFileSync(p.targetPath, 'a user-authored note, not ours\n');
    expect(previewProposal(p).conflict).toBe(true);
    expect(applyProposal(p, ctx.homeDir)).toBe('conflict');
    expect(fs.readFileSync(p.targetPath, 'utf-8')).toBe('a user-authored note, not ours\n');
  });

  it('merges a hook into settings.json idempotently and strips it on undo', () => {
    const p = hookProposal();
    expect(applyProposal(p, ctx.homeDir)).toBe('applied');
    const settings = JSON.parse(fs.readFileSync(p.targetPath, 'utf-8'));
    expect(settings.hooks.PostToolUse[0].matcher).toBe('Edit|Write');
    expect(applyProposal(p, ctx.homeDir)).toBe('unchanged');
    expect(undoProposal(p, ctx.homeDir)).toBe('undone');
    const stripped = JSON.parse(fs.readFileSync(p.targetPath, 'utf-8'));
    expect(stripped.hooks).toBeUndefined();
  });
});
