/**
 * REQ-LOWEND-003 — the lite-tier compact server instructions.
 *
 * Both variants live in `src/mcp/server-instructions.ts` (single source of
 * truth for agent-facing guidance, issue #529). These tests pin the three
 * acceptance criteria: lite references only post-trim tools and no JIRA (A1),
 * lite is at most a third of full (A2), and standard/full are untouched (A3).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  SERVER_INSTRUCTIONS,
  LITE_SERVER_INSTRUCTIONS,
  serverInstructionsFor,
  resolveServerInstructions,
} from '../src/mcp/server-instructions';
import { getStaticTools } from '../src/mcp/tools';
import { recordSessionModel } from '../src/mcp/model-context';

/** A temp project with a `.specship/` root so `findNearestSpecShipRoot` resolves. */
function withProject<T>(fn: (dir: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lite-instructions-'));
  fs.mkdirSync(path.join(dir, '.specship'));
  fs.writeFileSync(path.join(dir, '.specship', 'specship.db'), '');
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('REQ-LOWEND-003.A1 — lite instructions name only lite-visible tools', () => {
  // @verifies REQ-LOWEND-003
  function liteNamesOnlyPostTrimToolsAndNoJira(): void {
    expect(LITE_SERVER_INSTRUCTIONS).not.toMatch(/jira/i);
    for (const trimmed of [
      'specship_callers',
      'specship_callees',
      'specship_impact',
      'specship_files',
      'specship_health',
    ]) {
      expect(LITE_SERVER_INSTRUCTIONS).not.toContain(trimmed);
    }

    const visible = withProject((dir) => {
      recordSessionModel(dir, 'claude-haiku-4-5');
      return new Set(getStaticTools(dir).map((t) => t.name));
    });
    // Every tool token in the lite prose survives the lite tool-list trim.
    const mentioned = new Set(LITE_SERVER_INSTRUCTIONS.match(/specship_[a-z_]+/g) ?? []);
    expect(mentioned.size).toBeGreaterThan(0);
    for (const name of mentioned) expect(visible.has(name)).toBe(true);
    // And the primary tool is definitely one of them.
    expect(mentioned.has('specship_explore')).toBe(true);
  }
  it('no JIRA guidance, no trimmed tool, every named tool still on the lite menu', liteNamesOnlyPostTrimToolsAndNoJira);

  it('keeps the explore-first rule and the grep anti-pattern', () => {
    expect(LITE_SERVER_INSTRUCTIONS).toMatch(/ONE `specship_explore` call/);
    expect(LITE_SERVER_INSTRUCTIONS).toMatch(/Grep/);
    expect(LITE_SERVER_INSTRUCTIONS).toMatch(/sub-agent/i);
  });
});

describe('REQ-LOWEND-003.A2 — lite is at most one third of full', () => {
  // @verifies REQ-LOWEND-003
  function liteIsAtMostOneThirdOfFull(): void {
    const lite = Buffer.byteLength(LITE_SERVER_INSTRUCTIONS, 'utf-8');
    const full = Buffer.byteLength(SERVER_INSTRUCTIONS, 'utf-8');
    expect(lite * 3).toBeLessThanOrEqual(full);
  }
  it('byte length of the lite variant × 3 ≤ the full variant', liteIsAtMostOneThirdOfFull);
});

describe('REQ-LOWEND-003.A3 — standard and full are unchanged', () => {
  // @verifies REQ-LOWEND-003
  function nonLiteTiersGetTodaysInstructions(): void {
    expect(serverInstructionsFor('standard')).toBe(SERVER_INSTRUCTIONS);
    expect(serverInstructionsFor('full')).toBe(SERVER_INSTRUCTIONS);
    expect(serverInstructionsFor('lite')).toBe(LITE_SERVER_INSTRUCTIONS);
    // The full variant still carries the sections the lite one drops.
    expect(SERVER_INSTRUCTIONS).toMatch(/## JIRA integration/);
    expect(SERVER_INSTRUCTIONS).toContain('specship_impact');
  }
  it('standard/full → SERVER_INSTRUCTIONS verbatim; lite → the compact text', nonLiteTiersGetTodaysInstructions);
});

describe('resolveServerInstructions — agrees with the lite tool-list trim', () => {
  it('lite marker → compact text', () => {
    withProject((dir) => {
      recordSessionModel(dir, 'claude-haiku-4-5');
      expect(resolveServerInstructions(dir)).toBe(LITE_SERVER_INSTRUCTIONS);
    });
  });

  it('frontier marker → full text', () => {
    withProject((dir) => {
      recordSessionModel(dir, 'claude-fable-5');
      expect(resolveServerInstructions(dir)).toBe(SERVER_INSTRUCTIONS);
    });
  });

  it('SPECSHIP_COMPACT=0 overrides a lite marker → full text', () => {
    withProject((dir) => {
      recordSessionModel(dir, 'claude-haiku-4-5');
      const prev = process.env.SPECSHIP_COMPACT;
      process.env.SPECSHIP_COMPACT = '0';
      try {
        expect(resolveServerInstructions(dir)).toBe(SERVER_INSTRUCTIONS);
      } finally {
        if (prev === undefined) delete process.env.SPECSHIP_COMPACT;
        else process.env.SPECSHIP_COMPACT = prev;
      }
    });
  });

  it('null or unresolvable hint → full text (never compact blind)', () => {
    expect(resolveServerInstructions(null)).toBe(SERVER_INSTRUCTIONS);
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'lite-instructions-bare-'));
    try {
      expect(resolveServerInstructions(bare)).toBe(SERVER_INSTRUCTIONS);
    } finally {
      fs.rmSync(bare, { recursive: true, force: true });
    }
  });
});
