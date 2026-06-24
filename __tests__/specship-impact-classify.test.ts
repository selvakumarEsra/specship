import { describe, it, expect } from 'vitest';
import { isSpecshipTool, isSourceReturningTool, extractRequestedSymbols } from '../src/analytics/specship-impact';

describe('specship-impact classifiers', () => {
  it('isSpecshipTool matches all mcp__specship__* tools', () => {
    expect(isSpecshipTool('mcp__specship__specship_explore')).toBe(true);
    expect(isSpecshipTool('mcp__specship__designer_session')).toBe(true);
    expect(isSpecshipTool('Read')).toBe(false);
  });

  it('isSourceReturningTool only the code-graph readers', () => {
    for (const t of ['specship_node', 'specship_explore', 'specship_callers', 'specship_callees', 'specship_impact', 'specship_search', 'specship_files'])
      expect(isSourceReturningTool(`mcp__specship__${t}`)).toBe(true);
    expect(isSourceReturningTool('mcp__specship__designer_session')).toBe(false);
    expect(isSourceReturningTool('mcp__specship__specship_link_assert')).toBe(false);
    expect(isSourceReturningTool('mcp__specship__specship_link_verify')).toBe(false);
  });

  it('extractRequestedSymbols pulls names from input_json by tool', () => {
    expect(extractRequestedSymbols('mcp__specship__specship_node',
      JSON.stringify({ symbol: 'handleRequest' }))).toEqual(['handleRequest']);
    expect(extractRequestedSymbols('mcp__specship__specship_explore',
      JSON.stringify({ query: 'mutateElement renderScene' }))).toEqual(['mutateElement', 'renderScene']);
    expect(extractRequestedSymbols('mcp__specship__specship_explore',
      JSON.stringify({ query: 'how does updating an element rerender the canvas' }))).toEqual([]); // NL → none
    expect(extractRequestedSymbols('mcp__specship__specship_node', 'not json')).toEqual([]);
  });

  it('extractRequestedSymbols handles specship_callers with symbol key', () => {
    expect(extractRequestedSymbols('mcp__specship__specship_callers',
      JSON.stringify({ symbol: 'triggerUpdate' }))).toEqual(['triggerUpdate']);
    expect(extractRequestedSymbols('mcp__specship__specship_callers',
      JSON.stringify({}))).toEqual([]);
  });

  it('extractRequestedSymbols handles specship_callees with symbol key', () => {
    expect(extractRequestedSymbols('mcp__specship__specship_callees',
      JSON.stringify({ symbol: 'renderStaticScene' }))).toEqual(['renderStaticScene']);
  });

  it('extractRequestedSymbols handles specship_impact with symbol key', () => {
    expect(extractRequestedSymbols('mcp__specship__specship_impact',
      JSON.stringify({ symbol: 'mutateElement' }))).toEqual(['mutateElement']);
  });

  it('extractRequestedSymbols handles specship_search with query key', () => {
    // Single identifier token — treated as symbol bag
    expect(extractRequestedSymbols('mcp__specship__specship_search',
      JSON.stringify({ query: 'AuthService' }))).toEqual(['AuthService']);
    // Qualified Class.method token — kept whole
    expect(extractRequestedSymbols('mcp__specship__specship_search',
      JSON.stringify({ query: 'UserService.login' }))).toEqual(['UserService.login']);
    // Natural-language query — returns []
    expect(extractRequestedSymbols('mcp__specship__specship_search',
      JSON.stringify({ query: 'find all the auth handlers' }))).toEqual([]);
  });

  it('extractRequestedSymbols returns [] for non-source-bearing tools', () => {
    expect(extractRequestedSymbols('mcp__specship__specship_status', JSON.stringify({}))).toEqual([]);
    expect(extractRequestedSymbols('Read', JSON.stringify({ path: '/foo/bar.ts' }))).toEqual([]);
  });

  it('extractRequestedSymbols handles Class.method tokens in explore query', () => {
    expect(extractRequestedSymbols('mcp__specship__specship_explore',
      JSON.stringify({ query: 'DataRequest.task handleRequest' }))).toEqual(['DataRequest.task', 'handleRequest']);
  });

  it('extractRequestedSymbols returns [] when explore query has > 6 tokens', () => {
    // 7 valid identifier tokens — exceeds the ≤6 limit → treat as NL
    expect(extractRequestedSymbols('mcp__specship__specship_explore',
      JSON.stringify({ query: 'a b c d e f g' }))).toEqual([]);
  });

  it('extractRequestedSymbols handles null/undefined inputJson gracefully', () => {
    expect(extractRequestedSymbols('mcp__specship__specship_node', null)).toEqual([]);
    expect(extractRequestedSymbols('mcp__specship__specship_node', undefined)).toEqual([]);
  });
});
