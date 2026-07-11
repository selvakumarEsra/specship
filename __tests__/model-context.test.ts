import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  modelTier,
  detectModelTier,
  recordSessionModel,
  compactToolResult,
  readModelFromTranscript,
} from '../src/mcp/model-context';
import { modelMarkerPath } from '../src/statusline/paths';
import { buildSegment } from '../src/statusline';

/**
 * MODCTX-DOC (specs/model-aware-context.md) — model-aware compaction:
 * detection via the status-line marker (001), fence-preserving prose
 * compression (002), visible + opt-outable (003).
 */

const SAMPLE = `## Exploration: foo bar

Found 12 symbols across 3 files.

### Blast radius — what depends on these (update/verify before editing)

- \`a\` (src/a.ts:1) — 3 callers
- \`b\` (src/b.ts:2) — 2 callers
- \`c\` (src/c.ts:3) — 1 caller
- \`d\` (src/d.ts:4) — 1 caller
- \`e\` (src/e.ts:5) — 1 caller

### Source Code

> The code below is the **verbatim, current on-disk source** of these files — re-read from disk on this call and line-numbered, byte-for-byte identical to what the Read tool returns. It is NOT a summary, outline, or stale cache. Treat each block as a Read you have already performed: do not Read a file shown here.

\`\`\`typescript
1\texport function a() {

2\t  return 1;
3\t}
\`\`\`



> Some file sections were trimmed for size. For a specific symbol you still need, run another \`specship_explore\` (or \`specship_node\`) with its exact name — line-numbered source, cheaper and more complete than Read.
`;

describe('model tier resolution (REQ-MODCTX-001)', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modctx-'));
    fs.mkdirSync(path.join(dir, '.specship'), { recursive: true });
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('maps ids and display names to tiers', () => {
    expect(modelTier('claude-haiku-4-5-20251001')).toBe('haiku');
    expect(modelTier('Sonnet 4.6')).toBe('sonnet');
    expect(modelTier('claude-fable-5')).toBe('full');
    expect(modelTier(null)).toBe('full');
  });

  it('A1: a status-line render with a model records the marker', () => {
    const stdin = JSON.stringify({
      model: { display_name: 'Haiku 4.5' },
      workspace: { current_dir: dir },
    });
    buildSegment(stdin, true);
    expect(detectModelTier(dir, {})).toBe('haiku');
  });

  it('A2: no marker + no override → full tier', () => {
    expect(detectModelTier(dir, {})).toBe('full');
  });

  it('A3: SPECSHIP_MODEL overrides the marker', () => {
    recordSessionModel(dir, 'Sonnet 4.6');
    expect(detectModelTier(dir, { SPECSHIP_MODEL: 'claude-haiku-4-5' })).toBe('haiku');
  });

  it('marker write is change-gated (same model → same mtime)', () => {
    recordSessionModel(dir, 'Haiku 4.5');
    const first = fs.readFileSync(modelMarkerPath(dir), 'utf-8');
    recordSessionModel(dir, 'Haiku 4.5');
    expect(fs.readFileSync(modelMarkerPath(dir), 'utf-8')).toBe(first);
  });
});

describe('readModelFromTranscript (REQ-MODCTX-001.A4/A5)', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modctx-tr-')); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const line = (obj: unknown) => JSON.stringify(obj) + '\n';
  const assistant = (model: string) => line({ type: 'assistant', message: { model, content: [] } });
  const user = () => line({ type: 'user', message: { content: 'hi' } });

  it('A4: returns the NEWEST assistant turn model', () => {
    const p = path.join(dir, 't.jsonl');
    fs.writeFileSync(p, user() + assistant('claude-fable-5') + user() + assistant('claude-haiku-4-5-20251001') + user());
    expect(readModelFromTranscript(p)).toBe('claude-haiku-4-5-20251001');
  });

  it('A5: tail-bounded — finds the model even in a transcript far larger than the tail window', () => {
    const p = path.join(dir, 'big.jsonl');
    const filler = line({ type: 'user', message: { content: 'x'.repeat(2000) } });
    fs.writeFileSync(p, filler.repeat(200) + assistant('Sonnet 4.6') + user());
    expect(fs.statSync(p).size).toBeGreaterThan(64 * 1024);
    expect(readModelFromTranscript(p)).toBe('Sonnet 4.6');
  });

  it('A5: malformed lines, empty files, and missing files return null, never throw', () => {
    const p = path.join(dir, 'junk.jsonl');
    fs.writeFileSync(p, 'not json\n{"type":"assistant"\n\n');
    expect(readModelFromTranscript(p)).toBeNull();
    fs.writeFileSync(path.join(dir, 'empty.jsonl'), '');
    expect(readModelFromTranscript(path.join(dir, 'empty.jsonl'))).toBeNull();
    expect(readModelFromTranscript(path.join(dir, 'nope.jsonl'))).toBeNull();
  });

  it('A4 end-to-end shape: transcript → marker → tier', () => {
    fs.mkdirSync(path.join(dir, '.specship'));
    const p = path.join(dir, 't.jsonl');
    fs.writeFileSync(p, assistant('claude-haiku-4-5'));
    const model = readModelFromTranscript(p);
    expect(model).toBe('claude-haiku-4-5');
    recordSessionModel(dir, model!);
    expect(detectModelTier(dir, {})).toBe('haiku');
  });
});

describe('compactToolResult (REQ-MODCTX-002/003)', () => {
  it('A4/003.A2: full tier is the identity function', () => {
    expect(compactToolResult(SAMPLE, 'full')).toBe(SAMPLE);
  });

  it('A1: fenced code blocks are byte-identical at every tier', () => {
    const fence = SAMPLE.match(/```[\s\S]*?```/)![0];
    for (const tier of ['sonnet', 'haiku'] as const) {
      expect(compactToolResult(SAMPLE, tier)).toContain(fence);
    }
  });

  it('A2: the stop-reading signal survives compression', () => {
    const c = compactToolResult(SAMPLE, 'haiku');
    expect(c.toLowerCase()).toContain('already read');
    expect(c).toContain('do NOT Read');
    // The long boilerplate itself is gone.
    expect(c).not.toContain('byte-for-byte identical to what the Read tool returns');
    expect(c.length).toBeLessThan(SAMPLE.length + 80); // net smaller despite the marker line
  });

  it('A3: haiku caps the blast radius loudly, sonnet keeps it', () => {
    const h = compactToolResult(SAMPLE, 'haiku');
    expect(h).toContain('+2 more dependents');
    expect(h).not.toContain('`d` (src/d.ts:4)');
    const s = compactToolResult(SAMPLE, 'sonnet');
    expect(s).toContain('`e` (src/e.ts:5)');
  });

  it('003.A1: a compacted response names the tier and the opt-out once', () => {
    const c = compactToolResult(SAMPLE, 'sonnet');
    expect(c.startsWith('⛁ compact mode (sonnet) — SPECSHIP_COMPACT=0')).toBe(true);
    expect(c.match(/compact mode/g)).toHaveLength(1);
  });

  it('collapses blank-line runs in prose but not inside fences', () => {
    const c = compactToolResult(SAMPLE, 'sonnet');
    // Prose triple-blank collapsed…
    expect(/```\n{3,}/.test(c)).toBe(false);
    // …but the blank line INSIDE the fence survives.
    expect(c).toContain('export function a() {\n\n2\t  return 1;');
  });
});

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

describe.skipIf(!fts5Available)('handler integration (REQ-MODCTX-002/003 end-to-end)', () => {
  it('a real code-graph call compacts on a forced haiku tier and not on full', async () => {
    const { default: SpecShip } = await import('../src');
    const { ToolHandler } = await import('../src/mcp/tools');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modctx-e2e-'));
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'src', 'a.ts'), 'export function alpha() { return 1; }\n');
    const cg = await SpecShip.init(dir);
    await cg.indexAll();
    const handler = new ToolHandler(cg);
    const prevModel = process.env.SPECSHIP_MODEL;
    const prevCompact = process.env.SPECSHIP_COMPACT;
    try {
      process.env.SPECSHIP_MODEL = 'claude-haiku-4-5';
      delete process.env.SPECSHIP_COMPACT;
      const compacted = await handler.execute('specship_search', { query: 'alpha' });
      const text = (compacted.content?.[0] as { text?: string })?.text ?? '';
      expect(text).toContain('compact mode (haiku)');
      expect(text).toContain('alpha'); // payload intact

      // 003.A2: SPECSHIP_COMPACT=0 restores full output even on haiku.
      process.env.SPECSHIP_COMPACT = '0';
      const full = await handler.execute('specship_search', { query: 'alpha' });
      const fullText = (full.content?.[0] as { text?: string })?.text ?? '';
      expect(fullText).not.toContain('compact mode');
    } finally {
      if (prevModel === undefined) delete process.env.SPECSHIP_MODEL; else process.env.SPECSHIP_MODEL = prevModel;
      if (prevCompact === undefined) delete process.env.SPECSHIP_COMPACT; else process.env.SPECSHIP_COMPACT = prevCompact;
      cg.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
