import { describe, it, expect } from 'vitest';
import * as lib from '../src/analytics/specship-impact';
import * as srv from '../server/src/ingest/specship-classify';

/**
 * The classify logic is duplicated: the canonical copy lives in the lib
 * (src/analytics/specship-impact.ts) and a server-local copy lives in
 * server/src/ingest/specship-classify.ts (so the server carries no
 * runtime `@specship/specship` import). This test asserts the two stay
 * behaviourally identical — if you edit one, edit both, and this fails until
 * they match again.
 */

const TOOL_NAMES = [
  'mcp__specship__specship_node',
  'mcp__specship__specship_explore',
  'mcp__specship__specship_search',
  'mcp__specship__specship_callers',
  'mcp__specship__specship_callees',
  'mcp__specship__specship_impact',
  'mcp__specship__specship_files',
  'mcp__specship__specship_status',
  'mcp__specship__specship_link_assert',
  'mcp__specship__designer_session',
  'Read',
  'Bash',
];

const INPUTS = [
  JSON.stringify({ symbol: 'handleRequest' }),
  JSON.stringify({ query: 'mutateElement renderScene' }),
  JSON.stringify({ query: 'how does updating an element rerender the canvas' }),
  JSON.stringify({ query: 'AuthService.login UserService' }),
  'not json',
  null,
  undefined,
  JSON.stringify({ symbol: '' }),
];

const okGraph: srv.GraphLike = {
  estimateReadEquivalent: (symbols) =>
    symbols.length ? { files: [{ path: 'a.ts', size: 100 }], resolved: true } : { files: [], resolved: false },
};
const throwGraph: srv.GraphLike = {
  estimateReadEquivalent: () => { throw new Error('locked index'); },
};

describe('classify lib/server parity', () => {
  it('isSpecshipTool + isSourceReturningTool agree on every tool name', () => {
    for (const n of TOOL_NAMES) {
      expect(srv.isSpecshipTool(n)).toBe(lib.isSpecshipTool(n));
      expect(srv.isSourceReturningTool(n)).toBe(lib.isSourceReturningTool(n));
    }
  });

  it('extractRequestedSymbols agrees on every (tool, input) pair', () => {
    for (const n of TOOL_NAMES) {
      for (const inp of INPUTS) {
        expect(srv.extractRequestedSymbols(n, inp)).toEqual(lib.extractRequestedSymbols(n, inp));
      }
    }
  });

  it('classifyToolCall agrees across graphs (resolved / null / throwing)', () => {
    for (const n of TOOL_NAMES) {
      for (const inp of INPUTS) {
        for (const [len, graph] of [[120, okGraph], [120, null], [0, okGraph], [120, throwGraph]] as const) {
          const call = { toolName: n, inputJson: inp, resultLength: len };
          expect(srv.classifyToolCall(call, graph)).toEqual(lib.classifyToolCall(call, graph));
        }
      }
    }
  });
});
