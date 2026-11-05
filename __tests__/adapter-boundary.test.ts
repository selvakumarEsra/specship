/**
 * REQ-AGENTSWITCH-017 (specs/agent-switch.md) — agent-specific code lives in
 * the adapter layer: the Claude transcript line parser under the Claude
 * transcript adapter, the Gemini command renderer and the Claude-only config
 * shim under the installer targets.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { scanHostLiterals } from './helpers/host-literal-scan';
import { HOST_LITERAL_ALLOWLIST } from './fixtures/host-literal-allowlist';

const ROOT = path.resolve(__dirname, '..');
const exists = (rel: string) => fs.existsSync(path.join(ROOT, rel));

function walkTs(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== 'dist') walkTs(rel, out); }
    else if (/\.tsx?$/.test(e.name)) out.push(rel);
  }
  return out;
}

describe('REQ-AGENTSWITCH-017 — agent-specific code lives in the adapter layer', () => {
  it('REQ-AGENTSWITCH-017.A1: the moved modules sit in their adapter folders and the guard has no exceptions', reqAgentswitch017A1);
  function reqAgentswitch017A1(): void {
    expect(exists('server/src/ingest/transcripts/claude-jsonl.ts')).toBe(true);
    expect(exists('server/src/ingest/transcripts/shared.ts')).toBe(true);
    expect(exists('src/installer/targets/gemini-commands.ts')).toBe(true);
    expect(exists('src/installer/targets/claude-config-writer.ts')).toBe(true);
    for (const old of ['server/src/ingest/parser.ts', 'src/installer/gemini-commands.ts', 'src/installer/config-writer.ts']) {
      expect(exists(old), `${old} should have moved`).toBe(false);
    }
    // The Gemini adapter never reaches into the Claude one.
    const gemini = fs.readFileSync(path.join(ROOT, 'server/src/ingest/transcripts/gemini.ts'), 'utf-8');
    expect(gemini).not.toMatch(/claude-jsonl/);
    // Only the Claude adapter and the ingest barrel import the Claude parser; the
    // shared ingestor reaches the line format through the adapter interface.
    const importers = [...walkTs('server/src'), ...walkTs('src')].filter((f) =>
      /claude-jsonl/.test(fs.readFileSync(path.join(ROOT, f), 'utf-8')) && !f.endsWith('claude-jsonl.ts'));
    expect(importers.sort()).toEqual(['server/src/ingest/index.ts', 'server/src/ingest/transcripts/claude.ts']);
    expect(HOST_LITERAL_ALLOWLIST).toEqual([]);
    expect(scanHostLiterals(ROOT)).toEqual([]);
  }
});
