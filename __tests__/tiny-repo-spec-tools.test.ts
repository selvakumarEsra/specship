import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * REQ-AUDFIX-009 (specs/docs-audit-fixes.md) — the tiny-repo (<500 files)
 * tool-list trim targets code-graph tools only; the spec layer survives it
 * when the project has ≥1 indexed spec.
 *
 *   A1 — <500 files + ≥1 spec → spec, link assert/verify, drifted (and JIRA
 *        tools when enabled) are advertised.
 *   A2 — <500 files + no specs → list unchanged from the pre-fix trim.
 *   A3 — callers/callees/impact/files/health stay trimmed either way, and the
 *        lite-tier trim still applies on top.
 */

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

const SPEC_LAYER = ['specship_spec', 'specship_link_assert', 'specship_link_verify', 'specship_drifted'];
const TRIMMED_CODE_GRAPH = ['specship_callers', 'specship_callees', 'specship_impact', 'specship_files', 'specship_health'];
/** The pre-fix tiny-repo list (no integrations enabled). */
const TODAY_TINY_LIST = ['specship_explore', 'specship_node', 'specship_search', 'specship_status'];

const ENV_KEYS = ['SPECSHIP_MODEL', 'SPECSHIP_COMPACT', 'SPECSHIP_INTEGRATIONS', 'SPECSHIP_MCP_TOOLS'];

describe.skipIf(!fts5Available)('tiny-repo trim keeps the spec layer when specs exist (REQ-AUDFIX-009)', () => {
  const savedEnv: Record<string, string | undefined> = {};
  const projects: Array<{ dir: string; cg: { close(): void } }> = [];

  async function makeProject(withSpec: boolean) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tiny-spec-tools-'));
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(
      path.join(dir, 'src', 'rate.ts'),
      'export function checkRate(n: number) { return n < 10; }\n'
    );
    if (withSpec) {
      fs.mkdirSync(path.join(dir, 'specs'));
      fs.writeFileSync(
        path.join(dir, 'specs', 'rate.md'),
        [
          '<!-- id: RATE-DOC -->',
          '# Rate limiting',
          '',
          '<!-- id: REQ-RATE-001 -->',
          '## Requests MUST be rate limited',
          '',
          '## Acceptance',
          '<!-- id: REQ-RATE-001.A1 -->',
          '- The 11th request in a window is rejected.',
          '',
        ].join('\n')
      );
    }
    const { default: SpecShip } = await import('../src');
    const { ToolHandler } = await import('../src/mcp/tools');
    const cg = await SpecShip.init(dir);
    await cg.indexAll();
    projects.push({ dir, cg });
    const specCount = (cg.getSpecQueries().getRawDb()
      .prepare('SELECT COUNT(*) AS n FROM specs').get() as { n: number }).n;
    const handler = new ToolHandler(cg);
    const names = () => handler.getTools().map((t: { name: string }) => t.name).sort();
    return { cg, specCount, names };
  }

  beforeAll(() => {
    for (const k of ENV_KEYS) { savedEnv[k] = process.env[k]; delete process.env[k]; }
  });

  afterEach(() => {
    for (const k of ENV_KEYS) delete process.env[k];
  });

  afterAll(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    for (const p of projects) {
      try { p.cg.close(); } catch { /* already closed */ }
      fs.rmSync(p.dir, { recursive: true, force: true });
    }
  });

  it('REQ-AUDFIX-009.A1: <500 files with an indexed spec advertises the spec-layer tools', async () => {
    const { specCount, names } = await makeProject(true);
    expect(specCount).toBeGreaterThan(0);
    const list = names();
    for (const t of SPEC_LAYER) expect(list).toContain(t);
    // JIRA tools are absent when the integration is off…
    expect(list.some((n) => n.startsWith('specship_jira_'))).toBe(false);
    // …and advertised when it is enabled.
    process.env.SPECSHIP_INTEGRATIONS = 'jira';
    const withJira = names();
    expect(withJira.some((n) => n.startsWith('specship_jira_'))).toBe(true);
    for (const t of SPEC_LAYER) expect(withJira).toContain(t);
  });

  it('REQ-AUDFIX-009.A2: <500 files with no specs keeps exactly the pre-fix tiny-repo list', async () => {
    const { specCount, names } = await makeProject(false);
    expect(specCount).toBe(0);
    expect(names()).toEqual(TODAY_TINY_LIST);
    process.env.SPECSHIP_INTEGRATIONS = 'jira';
    expect(names().some((n) => n.startsWith('specship_jira_'))).toBe(false);
  });

  it('REQ-AUDFIX-009.A3: code-graph tools stay trimmed either way, and the lite trim applies on top', async () => {
    const withSpecs = await makeProject(true);
    const without = await makeProject(false);
    for (const list of [withSpecs.names(), without.names()]) {
      for (const t of TRIMMED_CODE_GRAPH) expect(list).not.toContain(t);
    }
    process.env.SPECSHIP_MODEL = 'claude-haiku-4-5';
    const lite = withSpecs.names();
    for (const t of TRIMMED_CODE_GRAPH) expect(lite).not.toContain(t);
    for (const t of ['specship_explore', 'specship_search', 'specship_node', 'specship_status']) {
      expect(lite).toContain(t);
    }
    // The lite trim leaves spec/link tools untouched (REQ-LOWMODEL-004).
    for (const t of SPEC_LAYER) expect(lite).toContain(t);
  });
});
