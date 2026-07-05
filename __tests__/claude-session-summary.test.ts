import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { registerClaudeRoutes } from '../server/src/routes/claude';
import { runMigrations } from '../src/db/migrations';

/**
 * REQ-DASHINT-003 (specs/dashboard-data-integrity.md): the session summary
 * endpoint must not 500 when a Skill/Task tool call's `input_summary` was
 * truncated by the ingestor (400 chars + '…' = malformed JSON). Regression:
 * `json_extract` over the truncated column threw SQLITE_ERROR and failed
 * the whole request; the skill name must come from the full `input_json`.
 */

let tmp: string;
let db: InstanceType<typeof Database>;
let app: FastifyInstance;

const LONG_SKILL_INPUT = JSON.stringify({
  skill: 'spec-author',
  args: 'x'.repeat(600), // pushes the serialized form well past the 400-char truncation
});
const TRUNCATED = LONG_SKILL_INPUT.slice(0, 400) + '…'; // exactly what the ingestor stores

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'summary-'));
  db = new Database(path.join(tmp, 'test.db'));
  // Real schema — base schema.sql + core migrations, so the test exercises
  // the exact columns the routes query.
  db.exec(fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'schema.sql'), 'utf8'));
  runMigrations(db as never, 0);
  db.prepare('INSERT INTO claude_projects (path, name, first_seen, last_seen) VALUES (?, ?, ?, ?)')
    .run('/tmp/proj', 'proj', 1000, 2000);
  db.prepare('INSERT INTO claude_sessions (id, project_path, source_file, started_at, ended_at) VALUES (?, ?, ?, ?, ?)')
    .run('sess1', '/tmp/proj', '/tmp/proj/s.jsonl', 1000, 2000);
  db.prepare(`INSERT INTO claude_prompts (id, session_id, ts) VALUES ('p1', 'sess1', 1400)`).run();
  db.prepare(`INSERT INTO claude_tool_calls (prompt_id, session_id, assistant_uuid, tool_name, input_summary, input_json, ts)
              VALUES ('p1', 'sess1', 'a1', 'Skill', ?, ?, 1500)`).run(TRUNCATED, LONG_SKILL_INPUT);
  // A Skill row malformed in BOTH columns — must degrade to 'unknown', not fail.
  db.prepare(`INSERT INTO claude_tool_calls (prompt_id, session_id, assistant_uuid, tool_name, input_summary, input_json, ts)
              VALUES ('p1', 'sess1', 'a2', 'Skill', '{broken', NULL, 1600)`).run();

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

describe('GET /api/claude/session/:id/summary (REQ-DASHINT-003)', () => {
  it('A1: returns 200 with the skill name from input_json despite truncated input_summary', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/claude/session/sess1/summary' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { skills: Array<{ name: string; count: number }> };
    const names = body.skills.map((s) => s.name);
    expect(names).toContain('spec-author');
  });

  it('A2: rows malformed in both columns degrade to unknown, request still succeeds', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/claude/session/sess1/summary' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { skills: Array<{ name: string; count: number }> };
    expect(body.skills.find((s) => s.name === 'unknown')?.count).toBe(1);
  });
});

describe('GET /api/claude/heatmap (Task subagent extraction hardened)', () => {
  it('does not 500 on truncated Task tool inputs', async () => {
    const longTask = JSON.stringify({ subagent_type: 'code-reviewer', prompt: 'y'.repeat(800) });
    db.prepare(`INSERT INTO claude_tool_calls (prompt_id, session_id, assistant_uuid, tool_name, input_summary, input_json, ts)
                VALUES ('p1', 'sess1', 'a3', 'Task', ?, ?, ?)`).run(longTask.slice(0, 400) + '…', longTask, Date.now());
    const res = await app.inject({ method: 'GET', url: '/api/claude/heatmap?range=all' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { subagentByName: Array<{ name: string }> };
    expect(body.subagentByName.map((s) => s.name)).toContain('code-reviewer');
  });
});
