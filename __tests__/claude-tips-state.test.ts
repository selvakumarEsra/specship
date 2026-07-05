import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { registerClaudeRoutes } from '../server/src/routes/claude';
import { runMigrations } from '../src/db/migrations';

/**
 * REQ-DESKTOP-020.A2: tip Apply / Dismiss persists (claude_tip_state) —
 * dismissed tips never resurface from GET /api/claude/tips even across a
 * server restart, applied ones stay in the list annotated. Plus the A4
 * signal: /api/claude/stats carries sessionCount so the dashboard can tell
 * "zero spend" from "nothing ingested".
 */

const OWN_ROOT = '/tmp/own-proj';

let tmp: string;
let dbPath: string;
let db: InstanceType<typeof Database>;
let app: FastifyInstance;

async function buildApp(database: InstanceType<typeof Database>): Promise<FastifyInstance> {
  const a = Fastify();
  a.decorate('primaryCg', {
    db: { getDb: () => database },
    getProjectRoot: () => OWN_ROOT,
    getSpecQueries: () => ({ getLinksByState: () => [] }),
  } as never);
  a.decorate('projects', {} as never);
  a.decorate('watcher', null as never);
  await registerClaudeRoutes(a);
  return a;
}

function seedSession(id: string, projectPath: string): void {
  db.prepare('INSERT OR IGNORE INTO claude_projects (path, name, first_seen, last_seen) VALUES (?, ?, ?, ?)')
    .run(projectPath, 'p', 1000, 2000);
  db.prepare('INSERT INTO claude_sessions (id, project_path, source_file, started_at, ended_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, projectPath, `${projectPath}/s.jsonl`, 1000, 2000);
  db.prepare('INSERT INTO claude_prompts (id, session_id, ts) VALUES (?, ?, 1400)').run(`p-${id}`, id);
}

function seedWastefulReads(sessionId: string, file: string): void {
  for (let i = 0; i < 11; i++) {
    db.prepare(`INSERT INTO claude_tool_calls (prompt_id, session_id, assistant_uuid, tool_name, input_summary, ts)
                VALUES (?, ?, ?, 'Read', ?, ?)`).run(`p-${sessionId}`, sessionId, `a-${sessionId}-${i}`, file, 1500 + i);
  }
}

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tips-state-'));
  dbPath = path.join(tmp, 'test.db');
  db = new Database(dbPath);
  db.exec(fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'schema.sql'), 'utf8'));
  runMigrations(db as never, 0);
  app = await buildApp(db);
});

afterEach(async () => {
  await app.close();
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

interface Tip { id: string; state?: string }

async function fetchTips(a: FastifyInstance = app): Promise<Tip[]> {
  const res = await a.inject({ method: 'GET', url: '/api/claude/tips' });
  expect(res.statusCode).toBe(200);
  return (res.json() as { tips: Tip[] }).tips;
}

async function seedOneTip(): Promise<string> {
  seedSession('s1', OWN_ROOT);
  seedWastefulReads('s1', 'src/index.ts');
  const tips = await fetchTips();
  const tip = tips.find((t) => t.id.startsWith('wasteful_reads:'));
  expect(tip).toBeDefined();
  return tip!.id;
}

describe('POST /api/claude/tips/state (REQ-DESKTOP-020.A2)', () => {
  it('dismissed tips are excluded from GET /api/claude/tips', async () => {
    const id = await seedOneTip();
    const res = await app.inject({ method: 'POST', url: '/api/claude/tips/state', payload: { id, state: 'dismissed' } });
    expect(res.statusCode).toBe(200);
    const tips = await fetchTips();
    expect(tips.find((t) => t.id === id)).toBeUndefined();
  });

  it('applied tips stay in the list annotated with state', async () => {
    const id = await seedOneTip();
    await app.inject({ method: 'POST', url: '/api/claude/tips/state', payload: { id, state: 'applied' } });
    const tip = (await fetchTips()).find((t) => t.id === id);
    expect(tip).toBeDefined();
    expect(tip!.state).toBe('applied');
  });

  it('state persists across a server restart (DB reopened from disk)', async () => {
    const id = await seedOneTip();
    await app.inject({ method: 'POST', url: '/api/claude/tips/state', payload: { id, state: 'dismissed' } });

    await app.close();
    db.close();
    db = new Database(dbPath);
    app = await buildApp(db);

    const tips = await fetchTips();
    expect(tips.find((t) => t.id === id)).toBeUndefined();
  });

  it('re-setting the same tip converges to one row (upsert)', async () => {
    const id = await seedOneTip();
    await app.inject({ method: 'POST', url: '/api/claude/tips/state', payload: { id, state: 'applied' } });
    await app.inject({ method: 'POST', url: '/api/claude/tips/state', payload: { id, state: 'dismissed' } });
    const rows = db.prepare('SELECT state FROM claude_tip_state WHERE tip_id = ?').all(id) as Array<{ state: string }>;
    expect(rows).toEqual([{ state: 'dismissed' }]);
    expect((await fetchTips()).find((t) => t.id === id)).toBeUndefined();
  });

  it('rejects a missing id or an unknown state', async () => {
    const noId = await app.inject({ method: 'POST', url: '/api/claude/tips/state', payload: { state: 'applied' } });
    expect(noId.statusCode).toBe(400);
    const badState = await app.inject({ method: 'POST', url: '/api/claude/tips/state', payload: { id: 'x', state: 'archived' } });
    expect(badState.statusCode).toBe(400);
  });
});

describe('GET /api/claude/stats sessionCount (REQ-DESKTOP-020.A4)', () => {
  it('is 0 on an empty ingest DB and counts sessions once ingested', async () => {
    const empty = await app.inject({ method: 'GET', url: '/api/claude/stats' });
    expect(empty.statusCode).toBe(200);
    expect((empty.json() as { sessionCount: number }).sessionCount).toBe(0);

    seedSession('s1', OWN_ROOT);
    const seeded = await app.inject({ method: 'GET', url: '/api/claude/stats' });
    expect((seeded.json() as { sessionCount: number }).sessionCount).toBe(1);
  });
});
