import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { registerClaudeRoutes } from '../server/src/routes/claude';
import { runMigrations } from '../src/db/migrations';

/**
 * REQ-DASHINT-006 (specs/dashboard-data-integrity.md): tips are mined from the
 * cross-project claude_* tables and must cite only the primary project's own
 * sessions — a wasteful pattern in another project's transcripts must not
 * surface as a tip here. Sessions store the project path in the mangled slug
 * round-trip form (every non-alphanumeric char → '/'), so both forms match.
 */

const OWN_ROOT = '/tmp/own-proj';
const OWN_MANGLED = OWN_ROOT.replace(/[^A-Za-z0-9]/g, '/'); // '/tmp/own/proj'
const OTHER_ROOT = '/somewhere/else';

let tmp: string;
let db: InstanceType<typeof Database>;
let app: FastifyInstance;

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
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tips-scope-'));
  db = new Database(path.join(tmp, 'test.db'));
  db.exec(fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'schema.sql'), 'utf8'));
  runMigrations(db as never, 0);

  app = Fastify();
  app.decorate('primaryCg', {
    db: { getDb: () => db },
    getProjectRoot: () => OWN_ROOT,
  } as never);
  app.decorate('projects', {} as never);
  app.decorate('watcher', null as never);
  await registerClaudeRoutes(app);
});

afterEach(async () => {
  await app.close();
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function fetchTips(): Promise<Array<{ id: string; title: string }>> {
  const res = await app.inject({ method: 'GET', url: '/api/claude/tips' });
  expect(res.statusCode).toBe(200);
  return (res.json() as { tips: Array<{ id: string; title: string }> }).tips;
}

describe('GET /api/claude/tips project scoping (REQ-DASHINT-006)', () => {
  it("A1: a wasteful pattern only in another project's sessions produces no tip", async () => {
    seedSession('other-s', OTHER_ROOT);
    seedWastefulReads('other-s', 'src/ibkr-file.ts');
    const tips = await fetchTips();
    expect(tips.filter((t) => t.id.startsWith('wasteful_reads:'))).toEqual([]);
  });

  it('A2: the same pattern in the primary project surfaces, in real or mangled path form', async () => {
    seedSession('own-real', OWN_ROOT);
    seedWastefulReads('own-real', 'src/index.ts');
    seedSession('own-mangled', OWN_MANGLED);
    seedWastefulReads('own-mangled', 'src/server.ts');
    const tips = await fetchTips();
    const wasteful = tips.filter((t) => t.id.startsWith('wasteful_reads:'));
    expect(wasteful.some((t) => t.id.includes('own-real'))).toBe(true);
    expect(wasteful.some((t) => t.id.includes('own-mangled'))).toBe(true);
  });
});

describe('model-escalation tip (MIXMODEL-DOC, REQ-MIX-002)', () => {
  function seedFlounder(sessionId: string, model: string, reads = 16): void {
    seedSession(sessionId, OWN_ROOT);
    db.prepare('UPDATE claude_sessions SET last_model = ? WHERE id = ?').run(model, sessionId);
    // Distinct files per Read so the same-file wasteful_reads rule stays out
    // of the way — this rule is about session-level volume, not one file.
    for (let i = 0; i < reads; i++) {
      db.prepare(`INSERT INTO claude_tool_calls (prompt_id, session_id, assistant_uuid, tool_name, input_summary, ts)
                  VALUES (?, ?, ?, 'Read', ?, ?)`)
        .run(`p-${sessionId}`, sessionId, `a-${sessionId}-${i}`, `src/f${i}.ts`, 1500 + i);
    }
  }

  it('A1: a floundering haiku session gets the escalation tip naming the mixed workflow', async () => {
    seedFlounder('haiku-s', 'claude-haiku-4-5-20251001');
    const tips = await fetchTips();
    const esc = tips.filter((t) => t.id.startsWith('model_escalation:'));
    expect(esc).toHaveLength(1);
    expect(esc[0].title).toContain('Haiku');
    expect((esc[0] as { fix?: string }).fix).toContain('spec-implement-mixed');
  });

  it('A1: the same Read volume on a frontier model produces no escalation tip', async () => {
    seedFlounder('fable-s', 'claude-fable-5');
    const tips = await fetchTips();
    expect(tips.filter((t) => t.id.startsWith('model_escalation:'))).toEqual([]);
  });

  it('below the threshold, no tip', async () => {
    seedFlounder('haiku-quiet', 'claude-haiku-4-5', 8);
    const tips = await fetchTips();
    expect(tips.filter((t) => t.id.startsWith('model_escalation:'))).toEqual([]);
  });
});
