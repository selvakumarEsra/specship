/**
 * Condition evaluator + $nodeId.output substitution tests.
 */

import { describe, it, expect } from 'vitest';
import {
  substituteRefs,
  evaluateCondition,
  OutputRefError,
} from '../src/workflows/condition-evaluator';

function ctx(outputs: Record<string, { text: string }>, opts: Partial<{ inputs: Record<string, string>; variables: Record<string, string> }> = {}) {
  return {
    outputs: new Map(Object.entries(outputs)),
    inputs: opts.inputs ?? {},
    variables: opts.variables ?? {},
  };
}

describe('substituteRefs', () => {
  it('substitutes $nodeId.output with the text', () => {
    const out = substituteRefs('prefix $a.output suffix', ctx({ a: { text: 'BODY' } }));
    expect(out).toBe('prefix BODY suffix');
  });

  it('substitutes $INPUT.NAME', () => {
    const out = substituteRefs('id=$INPUT.SPEC_ID', ctx({}, { inputs: { SPEC_ID: 'REQ-1' } }));
    expect(out).toBe('id=REQ-1');
  });

  it('substitutes $VAR for static variables', () => {
    const out = substituteRefs('dir=$ARTIFACTS_DIR', ctx({}, { variables: { ARTIFACTS_DIR: '/tmp/x' } }));
    expect(out).toBe('dir=/tmp/x');
  });

  it('throws OutputRefError for unknown node', () => {
    expect(() => substituteRefs('$ghost.output', ctx({}))).toThrowError(OutputRefError);
  });

  it('throws OutputRefError for missing field', () => {
    expect(() => substituteRefs('$a.output.missing', ctx({ a: { text: '{"x": 1}' } }))).toThrowError(
      OutputRefError
    );
  });

  it('accesses JSON-parsed fields', () => {
    const out = substituteRefs(
      'value=$a.output.k',
      ctx({ a: { text: '{"k": "hello"}' } })
    );
    expect(out).toBe('value=hello');
  });

  it('quotes for bash safety', () => {
    const out = substituteRefs('echo $a.output', ctx({ a: { text: "it's a test" } }), {
      forBash: true,
    });
    expect(out).toContain("'it'\\''s a test'");
  });
});

describe('evaluateCondition', () => {
  it('handles == and !=', () => {
    expect(evaluateCondition("'a' == 'a'", ctx({}))).toBe(true);
    expect(evaluateCondition("'a' != 'b'", ctx({}))).toBe(true);
    expect(evaluateCondition("'a' == 'b'", ctx({}))).toBe(false);
  });

  it('handles numeric comparisons', () => {
    expect(evaluateCondition('3 < 5', ctx({}))).toBe(true);
    expect(evaluateCondition('3 > 5', ctx({}))).toBe(false);
    expect(evaluateCondition('5 >= 5', ctx({}))).toBe(true);
  });

  it('handles && and ||', () => {
    expect(evaluateCondition("'a' == 'a' && 1 < 2", ctx({}))).toBe(true);
    expect(evaluateCondition("'a' == 'b' && 1 < 2", ctx({}))).toBe(false);
    expect(evaluateCondition("'a' == 'b' || 1 < 2", ctx({}))).toBe(true);
  });

  it('substitutes $refs in conditions', () => {
    const c = ctx({ a: { text: 'PASS' } });
    expect(evaluateCondition("$a.output == 'PASS'", c)).toBe(true);
    expect(evaluateCondition("$a.output == 'FAIL'", c)).toBe(false);
  });

  it('fails closed on unresolvable $ref', () => {
    expect(evaluateCondition("$ghost.output == 'x'", ctx({}))).toBe(false);
  });

  it('empty string is falsy under truthy fallback', () => {
    expect(evaluateCondition('', ctx({}))).toBe(false);
  });

  it('non-empty bare string is truthy (no operator)', () => {
    // Documented semantics: no operator → truthy test on the value.
    expect(evaluateCondition('something', ctx({}))).toBe(true);
  });
});
