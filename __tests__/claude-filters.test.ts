import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { registerClaudeRoutes } from '../packages/server/src/routes/claude';
import { runMigrations } from '../src/db/migrations';

/**
 * REQ-DESKTOP-024.A2: the model and project querystrings narrow the analytics
 * routes — /api/claude/sessions (model + project), /api/claude/costs
 * (model + project across total/topPrompts/series/byModel), and
 * /api/claude/heatmap (project across files/tools/subagents).
 */

const PROJ_A = '/tmp/proj-a';
const PROJ_B = '/tmp/proj-b';
const OPUS = 'claude-opus-4-7';
const HAIKU = 'claude-haiku-4-5';
const NOW = Date.now();

let tmp: string;
let db: InstanceType<typeof Database>;
let app: FastifyInstance;

async function buildApp(database: InstanceType<typeof Database>): Promise<FastifyInstance> {
  const a = Fastify();
  a.decorate('primaryCg', {
    db: { getDb: () => database },
    getProjectRoot: () => PROJ_A,
    getSpecQueries: () => ({ getLinksByState: () => [] }),
  } as never);
  a.decorate('projects', {} as never);
  a.decorate('watcher', null as never);
  await registerClaudeRoutes(a);
  return a;
}

function seedProject(projectPath: string): void {
  db.prepare('INSERT OR IGNORE INTO claude_projects (path, name, first_seen, last_seen) VALUES (?, ?, ?, ?)')
    .run(projectPath, path.basename(projectPath), NOW - 10_000, NOW);
}

function seedSession(id: string, projectPath: string, model: string): void {
  seedProject(projectPath);
  db.prepare(`INSERT INTO claude_sessions (id, project_path, source_file, started_at, ended_at, last_model, total_cost_usd)
              VALUES (?, ?, ?, ?, ?, ?, 1.0)`)
    .run(id, projectPath, `${projectPath}/${id}.jsonl`, NOW - 60_000, NOW - 1000, model);
}

function seedPrompt(id: string, sessionId: string, model: string, cost: number): void {
  db.prepare(`INSERT INTO claude_prompts (id, session_id, text, ts, model, cost_usd) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(id, sessionId, 'prompt ' + id, NOW - 30_000, model, cost);
}

function seedToolCall(promptId: string, sessionId: string, tool: string, input: string): void {
  db.prepare(`INSERT INTO claude_tool_calls (prompt_id, session_id, assistant_uuid, tool_name, input_summary, result_length, ts)
              VALUES (?, ?, ?, ?, ?, 1000, ?)`)
    .run(promptId, sessionId, `a-${sessionId}-${tool}-${input}`, tool, input, NOW - 20_000);
}

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-filters-'));
  db = new Database(path.join(tmp, 'test.db'));
  db.exec(fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'schema.sql'), 'utf8'));
  runMigrations(db as never, 0);
  app = await buildApp(db);

  // Two projects, three sessions, two models.
  seedSession('sa1', PROJ_A, OPUS);
  seedSession('sa2', PROJ_A, HAIKU);
  seedSession('sb1', PROJ_B, OPUS);
  seedPrompt('pa1', 'sa1', OPUS, 2.0);
  seedPrompt('pa2', 'sa2', HAIKU, 0.5);
  seedPrompt('pb1', 'sb1', OPUS, 4.0);
  seedToolCall('pa1', 'sa1', 'Read', `${PROJ_A}/src/index.ts`);
  seedToolCall('pb1', 'sb1', 'Edit', `${PROJ_B}/src/other.ts`);
});

afterEach(async () => {
  await app.close();
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function getJson<T>(url: string): Promise<T> {
  const res = await app.inject({ method: 'GET', url });
  expect(res.statusCode).toBe(200);
  return res.json() as T;
}

interface SessionsBody { sessions: Array<{ id: string }> }

describe('GET /api/claude/sessions filters (REQ-DESKTOP-024.A2)', () => {
  it('model= narrows to sessions with that last_model', async () => {
    const all = await getJson<SessionsBody>('/api/claude/sessions');
    expect(all.sessions.map((s) => s.id).sort()).toEqual(['sa1', 'sa2', 'sb1']);

    const haiku = await getJson<SessionsBody>(`/api/claude/sessions?model=${HAIKU}`);
    expect(haiku.sessions.map((s) => s.id)).toEqual(['sa2']);
  });

  it('model= combines with project=', async () => {
    const both = await getJson<SessionsBody>(
      `/api/claude/sessions?project=${encodeURIComponent(PROJ_A)}&model=${OPUS}`,
    );
    expect(both.sessions.map((s) => s.id)).toEqual(['sa1']);
  });
});

interface CostsBody {
  total: number;
  topPrompts: Array<{ id: string; model: string | null }>;
  byModel: Array<{ model: string; cost: number }>;
  series: Array<{ day: number; cost: number }>;
}

describe('GET /api/claude/costs filters (REQ-DESKTOP-024.A2)', () => {
  it('model= narrows topPrompts, byModel, series and total to that model', async () => {
    const all = await getJson<CostsBody>('/api/claude/costs');
    expect(all.topPrompts).toHaveLength(3);
    expect(all.byModel).toHaveLength(2);

    const haiku = await getJson<CostsBody>(`/api/claude/costs?model=${HAIKU}`);
    expect(haiku.topPrompts.map((p) => p.id)).toEqual(['pa2']);
    expect(haiku.byModel).toEqual([{ model: HAIKU, prompts: 1, cost: 0.5 }]);
    expect(haiku.total).toBeCloseTo(0.5);
    expect(haiku.series.reduce((a, s) => a + s.cost, 0)).toBeCloseTo(0.5);
  });

  it('project= narrows the prompt rollups through the owning session', async () => {
    const projB = await getJson<CostsBody>(`/api/claude/costs?project=${encodeURIComponent(PROJ_B)}`);
    expect(projB.topPrompts.map((p) => p.id)).toEqual(['pb1']);
    expect(projB.total).toBeCloseTo(4.0);
  });

  it('project= and model= compose', async () => {
    const none = await getJson<CostsBody>(`/api/claude/costs?project=${encodeURIComponent(PROJ_B)}&model=${HAIKU}`);
    expect(none.topPrompts).toEqual([]);
    expect(none.total).toBe(0);
  });
});

interface HeatmapBody {
  files: Array<{ path: string }>;
  tools: Array<{ name: string }>;
}

describe('GET /api/claude/heatmap project filter (REQ-DESKTOP-024.A2)', () => {
  it('project= scopes files and tools to that project sessions', async () => {
    const all = await getJson<HeatmapBody>('/api/claude/heatmap');
    expect(all.files.map((f) => f.path).sort()).toEqual([`${PROJ_A}/src/index.ts`, `${PROJ_B}/src/other.ts`]);
    expect(all.tools.map((t) => t.name).sort()).toEqual(['Edit', 'Read']);

    const a = await getJson<HeatmapBody>(`/api/claude/heatmap?project=${encodeURIComponent(PROJ_A)}`);
    expect(a.files.map((f) => f.path)).toEqual([`${PROJ_A}/src/index.ts`]);
    expect(a.tools.map((t) => t.name)).toEqual(['Read']);
  });
});
