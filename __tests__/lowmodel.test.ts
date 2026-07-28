import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildSteeringNudge, STEERING_TEXT, STEERING_TEXT_HAIKU } from '../src/activation/steering';
import { recordSessionModel } from '../src/mcp/model-context';

/**
 * LOWMODEL-DOC (specs/lower-model-handling.md) — opinionated, not terse:
 *   001 — misses end with nearest matches + a copy-pasteable next call.
 *   002 — haiku gets the prescriptive steering template (≤~80 tokens).
 *   003 — haiku flow renders numbered explicit hops; evidence unchanged.
 *   004 — haiku menu trims to the core three; trimmed tools still execute;
 *         tier change fires the listChanged listener.
 *   005 — the harness accepts a model override (source-scan guard).
 */

const ROOT = path.join(__dirname, '..');

/** FTS5 availability probe (same pattern as the other DB suites). */
const fts5Available = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require('better-sqlite3');
    const db = new Database(':memory:');
    try { db.exec('CREATE VIRTUAL TABLE _probe USING fts5(x)'); db.close(); return true; }
    catch { db.close(); }
  } catch { /* fall through */ }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(':memory:');
    try { db.exec('CREATE VIRTUAL TABLE _probe USING fts5(x)'); db.close(); return true; }
    catch { db.close(); }
  } catch { /* Node < 22.5 */ }
  return false;
})();

describe('REQ-LOWMODEL-002 — tier-aware steering', () => {
  it('haiku marker → prescriptive template; frontier → standard line', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lowmodel-steer-'));
    fs.mkdirSync(path.join(dir, '.specship'));
    try {
      recordSessionModel(dir, 'claude-fable-5');
      expect(buildSteeringNudge(dir, {})).toBe(STEERING_TEXT);
      recordSessionModel(dir, 'claude-haiku-4-5');
      expect(buildSteeringNudge(dir, {})).toBe(STEERING_TEXT_HAIKU);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('A2: the haiku template stays under ~80 tokens and steers against subagents', () => {
    expect(STEERING_TEXT_HAIKU.length / 4).toBeLessThan(85); // ~4 chars/token
    expect(STEERING_TEXT_HAIKU).toContain('Do not spawn subagents');
    expect(STEERING_TEXT_HAIKU).toContain('specship_explore');
  });
});

describe('REQ-LOWMODEL-005 — harness model arm (source guard)', () => {
  it('run-all.sh threads EVAL_MODEL into both arms and hardcodes no model', () => {
    const sh = fs.readFileSync(path.join(ROOT, 'scripts', 'agent-eval', 'run-all.sh'), 'utf-8');
    expect(sh).toContain('EVAL_MODEL="${EVAL_MODEL:-opus}"'); // default preserved (A1)
    expect(sh).toContain('--model "$EVAL_MODEL"');
    expect(sh).not.toContain('--model opus');
  });
});

describe.skipIf(!fts5Available)('handler-level (REQ-LOWMODEL-001/003/004)', () => {
  let dir: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cg: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let handler: any;
  const savedEnv: Record<string, string | undefined> = {};

  const text = (r: { content?: Array<{ text?: string }> }) => r.content?.[0]?.text ?? '';

  beforeAll(async () => {
    for (const k of ['SPECSHIP_MODEL', 'SPECSHIP_COMPACT', 'SPECSHIP_INTEGRATIONS']) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lowmodel-'));
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(
      path.join(dir, 'src', 'pipeline.ts'),
      'export function alphaStart() { return betaMiddle(); }\n' +
      'export function betaMiddle() { return gammaEnd(); }\n' +
      'export function gammaEnd() { return 42; }\n'
    );
    // 510 stub files push the project past the tiny-repo gate (<500 files
    // trims the menu on EVERY tier) so the haiku-specific trim is what the
    // menu tests actually observe.
    const stubs = path.join(dir, 'src', 'stubs');
    fs.mkdirSync(stubs);
    for (let i = 0; i < 510; i++) {
      fs.writeFileSync(path.join(stubs, `stub_${i}.ts`), `export const stubValue${i} = ${i};\n`);
    }
    const { default: SpecShip } = await import('../src');
    const { ToolHandler } = await import('../src/mcp/tools');
    cg = await SpecShip.init(dir);
    await cg.indexAll();
    handler = new ToolHandler(cg);
  });

  afterAll(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    cg?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('001.A1: a near-miss search suggests real symbols and a literal next call', async () => {
    const r = await handler.execute('specship_search', { query: 'alphaStrt.betaMid' });
    const t = text(r);
    expect(t).toContain('alphaStart');
    expect(t).toMatch(/Next: specship_explore "/);
  });

  it('001.A2: a symbol-not-found on callers is never a bare "not found"', async () => {
    const r = await handler.execute('specship_callers', { symbol: 'alphaStrtTypo' });
    const t = text(r);
    expect(t).not.toMatch(/not found in the codebase$/m);
    expect(t).toMatch(/Next: specship_explore/);
  });

  it('003: haiku flow renders numbered explicit hops with inline mechanism; evidence unchanged', async () => {
    // NOTE: SPECSHIP_COMPACT=0 is the global tier kill-switch (it disables
    // detection, not just prose compaction), so the haiku arm runs with
    // compaction active — fenced code is untouched by it, which is exactly
    // what A2 asserts below.
    const full = text(await handler.execute('specship_explore', { query: 'alphaStart betaMiddle gammaEnd' }));
    process.env.SPECSHIP_MODEL = 'claude-haiku-4-5';
    const haiku = text(await handler.execute('specship_explore', { query: 'alphaStart betaMiddle gammaEnd' }));
    delete process.env.SPECSHIP_MODEL;

    expect(haiku).toMatch(/2\. → betaMiddle \(.+\) — via /);
    expect(full).not.toMatch(/— via /); // full tier keeps the ↓ layout
    // A2: identical evidence — every source line of the pipeline is in both.
    for (const l of ['export function alphaStart()', 'export function betaMiddle()', 'export function gammaEnd()']) {
      expect(full).toContain(l);
      expect(haiku).toContain(l);
    }
  });

  it('004.A1: haiku trims the code-graph menu to the core three; frontier list unchanged', async () => {
    const names = () => handler.getTools().map((t: { name: string }) => t.name);
    const fullList = names();
    process.env.SPECSHIP_MODEL = 'claude-haiku-4-5';
    const haikuList = names();
    delete process.env.SPECSHIP_MODEL;

    for (const t of ['specship_explore', 'specship_search', 'specship_node']) {
      expect(haikuList).toContain(t);
    }
    for (const t of ['specship_callers', 'specship_impact', 'specship_status', 'specship_maintainability']) {
      expect(fullList).toContain(t);
      expect(haikuList).not.toContain(t);
    }
    // REQ-MCPVER-001.A4: specship_version survives both the tiny-repo and
    // haiku menu trims — it's the identity probe, always available.
    expect(fullList).toContain('specship_version');
    expect(haikuList).toContain('specship_version');
    expect(names()).toEqual(fullList); // back to full after env cleared
  });

  it('004.A2: a trimmed-away tool still executes on the haiku tier', async () => {
    process.env.SPECSHIP_MODEL = 'claude-haiku-4-5';
    const r = await handler.execute('specship_callers', { symbol: 'betaMiddle' });
    delete process.env.SPECSHIP_MODEL;
    expect(text(r)).toContain('alphaStart'); // real answer, not "unknown tool"
  });

  it('004.A3: a tier change fires the list-changed listener exactly once per switch', async () => {
    // Settle the handler's tier state BEFORE registering — earlier tests in
    // this suite leave it wherever they ended.
    await handler.execute('specship_search', { query: 'alphaStart' }); // settle: full
    let fired = 0;
    const remove = handler.addTierChangeListener(() => fired++);
    process.env.SPECSHIP_MODEL = 'claude-haiku-4-5';
    await handler.execute('specship_search', { query: 'alphaStart' }); // full → haiku (fires)
    await handler.execute('specship_search', { query: 'alphaStart' }); // no change
    delete process.env.SPECSHIP_MODEL;
    await handler.execute('specship_search', { query: 'alphaStart' }); // haiku → full (fires)
    remove();
    expect(fired).toBe(2);
  });
});
