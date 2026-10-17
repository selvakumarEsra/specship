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

describe('tip copy honesty (REQ-AUDFIX-006)', () => {
  type Tip = { id: string; title: string; fix: string; saving: string; evidence: { detail: string } };

  async function seedAllRules(): Promise<Tip[]> {
    seedSession('own-all', OWN_ROOT);
    // Rule 1: same file Read ≥10×.
    seedWastefulReads('own-all', 'src/deep/index.ts');
    // Rule 2: one oversized tool result (200k characters).
    db.prepare(`INSERT INTO claude_tool_calls (prompt_id, session_id, assistant_uuid, tool_name, input_summary, result_length, ts)
                VALUES ('p-own-all', 'own-all', 'a-heavy', 'Bash', 'grep -r foo', 200000, 1600)`).run();
    // Rule 3: a 12-prompt session with a 10% cache read rate.
    db.prepare(`UPDATE claude_sessions SET prompt_count = 12, total_input_tokens = 900000,
                total_cache_creation_tokens = 0, total_cache_read_tokens = 100000 WHERE id = 'own-all'`).run();
    const res = await app.inject({ method: 'GET', url: '/api/claude/tips' });
    return (res.json() as { tips: Tip[] }).tips;
  }

  it('REQ-AUDFIX-006.A1: no tip renders a literal placeholder saving', async () => {
    const tips = await seedAllRules();
    expect(tips.some((t) => t.id.startsWith('low_cache:'))).toBe(true);
    for (const t of tips) {
      expect(t.saving).not.toMatch(/\$X|X\.XX/);
      expect(JSON.stringify(t)).not.toMatch(/\$X\.XX/);
    }
  });

  it('REQ-AUDFIX-006.A2: the large-result tip labels characters as characters and derives $ from the token estimate', async () => {
    const tips = await seedAllRules();
    const heavy = tips.find((t) => t.id.startsWith('heavy_result:'))!;
    expect(heavy).toBeDefined();
    expect(heavy.title).toContain('200k chars');
    expect(heavy.title).toContain('~50k tokens est.');
    expect(heavy.title).not.toMatch(/200k tokens/);
    expect(heavy.evidence.detail).toContain('200000 chars');
    expect(heavy.evidence.detail).not.toMatch(/200000 tokens/);
    // 200000 chars / 4 = 50000 est. tokens × $15/M = $0.75 (not $3.00 from raw chars).
    expect(heavy.saving).toBe('~$0.75 est. on this call');
  });

  it('REQ-AUDFIX-006.A3: every fix names a real invocation (no specship_explore --symbol)', async () => {
    const tips = await seedAllRules();
    const wasteful = tips.find((t) => t.id.startsWith('wasteful_reads:'))!;
    expect(wasteful.fix).toBe('specship_explore "index.ts"');
    for (const t of tips) {
      expect(t.fix).not.toContain('--symbol');
      expect(t.fix).toMatch(/^(specship_(explore|search) |specship |Pin a stable)/);
    }
  });
});
