/**
 * LEARN-DOC (specs/learning-loop.md) — crystallize success, recall experience.
 *
 *   001 — success miners: completed-run recipes + error→workaround pairs.
 *   002 — explicit capture converges through the proposal store.
 *   003 — Prior-work section rides inline in explore (e2e).
 *   004 — session outcome records are deterministic joins, no test claims.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DatabaseConnection } from '../src/db';
import { SqliteDatabase } from '../src/db/sqlite-adapter';
import {
  mineProposals,
  capture,
  ReflectStore,
  sessionOutcome,
  sessionsTouchingFiles,
  ReflectContext,
} from '../src/reflect';

let dir: string;
let conn: DatabaseConnection;
let db: SqliteDatabase;
let ctx: ReflectContext;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'specship-learn-'));
  conn = DatabaseConnection.initialize(path.join(dir, 'test.db'));
  db = conn.getDb();
  fs.mkdirSync(path.join(dir, 'home'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'proj'), { recursive: true });
  ctx = { projectRoot: path.join(dir, 'proj'), homeDir: path.join(dir, 'home') };
  sessionPromptIds.clear(); // fresh DB per test — never reuse prompt ids
});

afterEach(() => {
  try { conn.close(); } catch { /* ignore */ }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
});

let callSeq = 0;
function seedSession(id: string, opts: { projectPath?: string; startedAt?: number; endedAt?: number } = {}): void {
  const p = opts.projectPath ?? ctx.projectRoot;
  db.prepare(`INSERT OR IGNORE INTO claude_projects (path, name, first_seen, last_seen) VALUES (?,?,?,?)`).run(p, 'p', 1, 1);
  db.prepare(
    `INSERT OR IGNORE INTO claude_sessions (id, project_path, source_file, started_at, ended_at, prompt_count, total_cost_usd)
     VALUES (?,?,?,?,?,?,?)`,
  ).run(id, p, 'f.jsonl', opts.startedAt ?? 1000, opts.endedAt ?? 2000, 0, 1.23);
}
function seedPrompt(sessionId: string, text: string, ts = 1100): string {
  const id = `p-${sessionId}-${++callSeq}`;
  db.prepare(`INSERT INTO claude_prompts (id, session_id, text, ts) VALUES (?,?,?,?)`).run(id, sessionId, text, ts);
  return id;
}
const sessionPromptIds = new Map<string, string>();
function seedCall(sessionId: string, tool: string, summary: string, ts = 1200): void {
  let promptId = sessionPromptIds.get(sessionId);
  if (!promptId) {
    promptId = seedPrompt(sessionId, `anchor prompt for ${sessionId}`, 1050);
    sessionPromptIds.set(sessionId, promptId);
  }
  db.prepare(
    `INSERT INTO claude_tool_calls (prompt_id, session_id, assistant_uuid, tool_name, input_summary, ts, is_specship)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(promptId, sessionId, `a-${++callSeq}`, tool, summary, ts, tool.includes('specship') ? 1 : 0);
}
function seedRun(id: string, name: string, status: string, steps: string[], opts: { createdAt?: number; completedAt?: number } = {}): void {
  db.prepare(
    `INSERT INTO workflow_runs (id, workflow_name, status, inputs, metadata, created_at, completed_at, last_activity_at)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).run(
    id, name, status,
    JSON.stringify({ SPEC_ID: 'REQ-X-001' }),
    JSON.stringify({ completedNodes: steps }),
    opts.createdAt ?? 1200, opts.completedAt ?? 1800, opts.completedAt ?? 1800,
  );
}

describe('REQ-LEARN-001 — success crystallization miners', () => {
  it('A1: a completed ≥5-step run yields a skill recipe proposal citing the run', () => {
    seedSession('s1');
    seedRun('run-1', 'spec-implement', 'completed', ['fetch_spec', 'plan', 'approve_plan', 'implement', 'verify', 'link']);
    const proposals = mineProposals(db, ctx).filter((p) => p.title.includes('spec-implement run as a recipe'));
    expect(proposals).toHaveLength(1);
    const p = proposals[0]!;
    expect(p.type).toBe('skill');
    expect(p.evidence.detail).toContain('run-1');
    expect(p.payload.kind).toBe('command');
    expect((p.payload as { content: string }).content).toContain('1. fetch_spec');
    expect((p.payload as { content: string }).content).toContain('specship workflow run spec-implement');
  });

  it('A1 guard: incomplete or short runs propose nothing', () => {
    seedSession('s1');
    seedRun('run-2', 'spec-fix', 'failed', ['a', 'b', 'c', 'd', 'e', 'f']);
    seedRun('run-3', 'spec-verify', 'completed', ['a', 'b']); // < 5 steps
    expect(mineProposals(db, ctx).filter((p) => p.title.includes('as a recipe'))).toEqual([]);
  });

  it('A2: a re-run-in-altered-form command recurring across sessions yields a working-form rule', () => {
    for (const s of ['s1', 's2']) {
      seedSession(s);
      seedCall(s, 'Bash', 'npm tst', 1200);
      seedCall(s, 'Bash', 'npm test -- --run', 1300);
    }
    const proposals = mineProposals(db, ctx).filter((p) => p.title.startsWith('Working form:'));
    expect(proposals).toHaveLength(1);
    expect((proposals[0]!.payload as { note?: string; block?: string; content?: string }));
    expect(proposals[0]!.body).toContain('2 sessions');
    expect(proposals[0]!.evidence.sessions.sort()).toEqual(['s1', 's2']);
  });

  it('A2 guard: a single-session retry proposes nothing', () => {
    seedSession('s1');
    seedCall('s1', 'Bash', 'npm tst', 1200);
    seedCall('s1', 'Bash', 'npm test -- --run', 1300);
    expect(mineProposals(db, ctx).filter((p) => p.title.startsWith('Working form:'))).toEqual([]);
  });

  it('A3: re-mining converges to one row per pattern', () => {
    seedSession('s1');
    seedRun('run-1', 'spec-implement', 'completed', ['a', 'b', 'c', 'd', 'e']);
    const store = new ReflectStore(db);
    store.upsertMined(mineProposals(db, ctx));
    store.upsertMined(mineProposals(db, ctx));
    const recipes = store.list().filter((p) => p.title.includes('as a recipe'));
    expect(recipes).toHaveLength(1);
  });
});

describe('REQ-LEARN-002 — explicit capture', () => {
  it('A1+A3: capture creates an open skill proposal with explicit provenance, converging on re-capture', () => {
    const p1 = capture(db, ctx, { title: 'Release a version', content: '1. bump\n2. push\n3. run workflow' });
    expect(p1.type).toBe('skill');
    expect(p1.state).toBe('open');
    expect(p1.evidence.detail).toContain('/specship:learn');
    const p2 = capture(db, ctx, { title: 'Release a version', content: '1. bump\n2. push\n3. run workflow' });
    expect(p2.contentHash).toBe(p1.contentHash);
    expect(new ReflectStore(db).list().filter((p) => p.contentHash === p1.contentHash)).toHaveLength(1);
  });
});

describe('REQ-LEARN-004 — session outcome records', () => {
  it('A1: lists edited files, in-window runs with status, and cost', () => {
    seedSession('s1', { startedAt: 1000, endedAt: 2000 });
    seedPrompt('s1', 'implement the uninstall purge behaviour', 1001);
    seedCall('s1', 'Edit', 'src/installer/index.ts', 1300);
    seedCall('s1', 'Write', 'src/installer/purge.ts', 1400);
    seedCall('s1', 'Bash', 'npm test', 1500);
    seedCall('s1', 'mcp__specship__specship_link_assert', 'REQ-U-001', 1600);
    seedRun('run-1', 'spec-implement', 'completed', ['a', 'b', 'c', 'd', 'e'], { createdAt: 1100, completedAt: 1900 });
    const o = sessionOutcome(db, 's1')!;
    expect(o.filesEdited.sort()).toEqual(['src/installer/index.ts', 'src/installer/purge.ts']);
    expect(o.workflowRuns).toEqual([{ id: 'run-1', name: 'spec-implement', status: 'completed' }]);
    expect(o.costUsd).toBe(1.23);
    expect(o.linksAsserted).toBe(1);
    expect(o.firstPrompt).toContain('uninstall purge');
  });

  it('A2: no test-outcome claim exists anywhere in the record shape', () => {
    seedSession('s1');
    const o = sessionOutcome(db, 's1')!;
    expect(Object.keys(o).join(',')).not.toMatch(/test/i);
  });

  it('sessionsTouchingFiles: project-scoped, suffix-matched, excludes recently-active sessions', () => {
    const old = Date.now() - 3 * 60 * 60_000;
    seedSession('mine', { startedAt: old, endedAt: old + 1000 });
    seedCall('mine', 'Edit', 'src/pipeline.ts');
    seedSession('theirs', { projectPath: '/somewhere/else', startedAt: old, endedAt: old + 1000 });
    seedCall('theirs', 'Edit', 'src/pipeline.ts');
    seedSession('live', { startedAt: Date.now() - 60_000, endedAt: Date.now() - 30_000 });
    seedCall('live', 'Edit', 'src/pipeline.ts');

    const forms: [string, string] = [ctx.projectRoot, ctx.projectRoot.replace(/[^A-Za-z0-9]/g, '/')];
    const hits = sessionsTouchingFiles(db, forms, ['src/pipeline.ts']);
    expect(hits).toEqual(['mine']); // other project excluded (A3 of 003), live session excluded
  });
});

/** FTS5 availability probe (same pattern as the other DB suites). */
const fts5Available = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require('better-sqlite3');
    const d = new Database(':memory:');
    try { d.exec('CREATE VIRTUAL TABLE _probe USING fts5(x)'); d.close(); return true; }
    catch { d.close(); }
  } catch { /* fall through */ }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync } = require('node:sqlite');
    const d = new DatabaseSync(':memory:');
    try { d.exec('CREATE VIRTUAL TABLE _probe USING fts5(x)'); d.close(); return true; }
    catch { d.close(); }
  } catch { /* Node < 22.5 */ }
  return false;
})();

describe.skipIf(!fts5Available)('REQ-LEARN-003 — Prior work inline in explore (e2e)', () => {
  it('A1+A2+A3: surfaces this project\'s past sessions on the touched files, silent otherwise', async () => {
    const { default: SpecShip } = await import('../src');
    const { ToolHandler } = await import('../src/mcp/tools');
    const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-e2e-'));
    fs.mkdirSync(path.join(proj, 'src'));
    fs.writeFileSync(path.join(proj, 'src', 'pipeline.ts'), 'export function alphaStart() { return 1; }\n');
    const cg = await SpecShip.init(proj);
    await cg.indexAll();
    const handler = new ToolHandler(cg);
    const text = async () => {
      const r = await handler.execute('specship_explore', { query: 'alphaStart' });
      return (r.content?.[0] as { text?: string })?.text ?? '';
    };

    // A2: no history → no section.
    expect(await text()).not.toContain('## Prior work');

    // Seed an old session (this project) + a foreign one into the PROJECT DB.
    const pdb = (cg.getSpecQueries() as unknown as { db: SqliteDatabase }).db;
    const old = Date.now() - 3 * 60 * 60_000;
    const seed = (sid: string, projectPath: string) => {
      pdb.prepare(`INSERT OR IGNORE INTO claude_projects (path, name, first_seen, last_seen) VALUES (?,?,?,?)`).run(projectPath, 'p', 1, 1);
      pdb.prepare(`INSERT INTO claude_sessions (id, project_path, source_file, started_at, ended_at, total_cost_usd) VALUES (?,?,?,?,?,?)`)
        .run(sid, projectPath, 'f.jsonl', old, old + 1000, 0.5);
      pdb.prepare(`INSERT INTO claude_prompts (id, session_id, text, ts) VALUES (?,?,?,?)`)
        .run(`p-${sid}`, sid, 'wire the alpha pipeline start', old + 10);
      pdb.prepare(`INSERT INTO claude_tool_calls (prompt_id, session_id, assistant_uuid, tool_name, input_summary, ts, is_specship)
                   VALUES (?,?,?,?,?,?,0)`)
        .run(`p-${sid}`, sid, `a-${sid}`, 'Edit', 'src/pipeline.ts', old + 20);
    };
    seed('prior-1', proj);
    seed('foreign-1', '/somewhere/else');

    const out = await text();
    expect(out).toContain('## Prior work');
    expect(out).toContain('prior-1'.slice(0, 8));
    expect(out).toContain('wire the alpha pipeline start');
    expect(out).not.toContain('foreign-'); // A3: other projects never surface

    cg.close();
    fs.rmSync(proj, { recursive: true, force: true });
  });
});
