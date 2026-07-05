import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { registerClaudeRoutes } from '../server/src/routes/claude';
import { runMigrations } from '../src/db/migrations';

/**
 * REQ-DESKTOP-019 — GET /api/claude/prompts/recent feeds the ⌘K command
 * palette's "recent prompts" results: newest main-chain user prompts, text
 * capped at 200 chars, optional per-project scoping (slug or raw path),
 * limit capped at 50. Sidechain and blank-text rows never surface — they'd
 * render as noise or empty entries in the palette.
 */

let tmp: string;
let db: InstanceType<typeof Database>;
let app: FastifyInstance;

function insertSession(id: string, projectPath: string): void {
  db.prepare('INSERT INTO claude_sessions (id, project_path, source_file, started_at, ended_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, projectPath, `${projectPath}/s.jsonl`, 1000, 9000);
}

function insertPrompt(id: string, sessionId: string, text: string | null, ts: number, sidechain = 0): void {
  db.prepare('INSERT INTO claude_prompts (id, session_id, text, ts, is_sidechain) VALUES (?, ?, ?, ?, ?)')
    .run(id, sessionId, text, ts, sidechain);
}

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prompts-recent-'));
  db = new Database(path.join(tmp, 'test.db'));
  db.exec(fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'schema.sql'), 'utf8'));
  runMigrations(db as never, 0);
  db.prepare('INSERT INTO claude_projects (path, name, first_seen, last_seen) VALUES (?, ?, ?, ?)')
    .run('/tmp/proja', 'proja', 1000, 2000);
  db.prepare('INSERT INTO claude_projects (path, name, first_seen, last_seen) VALUES (?, ?, ?, ?)')
    .run('/tmp/projb', 'projb', 1000, 2000);
  insertSession('sess-a', '/tmp/proja');
  insertSession('sess-b', '/tmp/projb');

  app = Fastify();
  app.decorate('primaryCg', { db: { getDb: () => db } } as never);
  app.decorate('projects', {} as never);
  app.decorate('watcher', null as never);
  await registerClaudeRoutes(app);
});

afterEach(async () => {
  await app.close();
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

interface PromptRow { id: string; session_id: string; text: string; ts: number }

async function fetchPrompts(qs = ''): Promise<PromptRow[]> {
  const res = await app.inject({ method: 'GET', url: `/api/claude/prompts/recent${qs}` });
  expect(res.statusCode).toBe(200);
  return (res.json() as { prompts: PromptRow[] }).prompts;
}

describe('GET /api/claude/prompts/recent (REQ-DESKTOP-019)', () => {
  it('returns prompts newest-first with id, session_id, text, ts', async () => {
    insertPrompt('p1', 'sess-a', 'oldest prompt', 1100);
    insertPrompt('p2', 'sess-a', 'middle prompt', 1200);
    insertPrompt('p3', 'sess-b', 'newest prompt', 1300);

    const prompts = await fetchPrompts();
    expect(prompts.map((p) => p.id)).toEqual(['p3', 'p2', 'p1']);
    expect(prompts[0]).toMatchObject({ id: 'p3', session_id: 'sess-b', text: 'newest prompt', ts: 1300 });
  });

  it('excludes sidechain and blank-text prompts, and caps text at 200 chars', async () => {
    insertPrompt('main', 'sess-a', 'x'.repeat(500), 1400);
    insertPrompt('side', 'sess-a', 'subagent task body', 1500, 1);
    insertPrompt('nul', 'sess-a', null, 1600);
    insertPrompt('blank', 'sess-a', '   ', 1700);

    const prompts = await fetchPrompts();
    expect(prompts.map((p) => p.id)).toEqual(['main']);
    expect(prompts[0].text).toHaveLength(200);
  });

  it('scopes to a project via ?project= (raw path and slug form both resolve)', async () => {
    insertPrompt('pa', 'sess-a', 'prompt in a', 1100);
    insertPrompt('pb', 'sess-b', 'prompt in b', 1200);

    const byPath = await fetchPrompts('?project=' + encodeURIComponent('/tmp/proja'));
    expect(byPath.map((p) => p.id)).toEqual(['pa']);

    // Slug form is what the UI's ProjectsService sends; the route decodes it.
    const bySlug = await fetchPrompts('?project=-tmp-projb');
    expect(bySlug.map((p) => p.id)).toEqual(['pb']);
  });

  it('defaults to 20 and hard-caps limit at 50', async () => {
    for (let i = 0; i < 60; i++) insertPrompt(`p${i}`, 'sess-a', `prompt ${i}`, 2000 + i);

    expect(await fetchPrompts()).toHaveLength(20);
    expect(await fetchPrompts('?limit=5')).toHaveLength(5);
    expect(await fetchPrompts('?limit=999')).toHaveLength(50);
  });

  it('responds 409 no_primary when no primary project is configured', async () => {
    const bare = Fastify();
    bare.decorate('primaryCg', null as never);
    bare.decorate('projects', {} as never);
    bare.decorate('watcher', null as never);
    await registerClaudeRoutes(bare);
    const res = await bare.inject({ method: 'GET', url: '/api/claude/prompts/recent' });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { code: string }).code).toBe('no_primary');
    await bare.close();
  });
});
