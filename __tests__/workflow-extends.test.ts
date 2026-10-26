import { describe, it, expect } from 'vitest';
import * as os from 'os';
import { discoverWorkflows, resolveExtends } from '../src/workflows/discovery';

/**
 * THROUGHPUT-DOC REQ-THRU-004 — a workflow may `extends:` another and override
 * per-node fields; the bundled spec-implement-mixed is expressed that way, so
 * a shared node changes in one place.
 */

const base = {
  name: 'base',
  description: 'base wf',
  nodes: [
    { id: 'a', kind: 'bash', bash: 'echo a' },
    { id: 'b', kind: 'prompt', prompt: 'do b', depends_on: ['a'] },
  ],
};

function extendsInheritsAndOverrides(): void {
  const r = resolveExtends(
    { name: 'child', extends: 'base', node_overrides: { b: { model: 'haiku' } } },
    (n) => (n === 'base' ? base : undefined),
  );
  expect(r.errors).toEqual([]);
  expect(r.value!.name).toBe('child');
  expect(r.value!.description).toBe('base wf');
  const nodes = r.value!.nodes as Array<Record<string, unknown>>;
  expect(nodes.map((n) => n.id)).toEqual(['a', 'b']);
  expect(nodes[0]).toEqual(base.nodes[0]); // untouched node is inherited as-is
  expect(nodes[1]).toEqual({ ...base.nodes[1], model: 'haiku' });
  expect(r.value!.extends).toBeUndefined();
  expect(r.value!.node_overrides).toBeUndefined();
}

function unknownBaseIsAnError(): void {
  const r = resolveExtends({ name: 'child', extends: 'nope' }, () => undefined);
  expect(r.value).toBeUndefined();
  expect(r.errors[0]!.message).toBe('extends unknown workflow "nope"');
  // An override naming a node the base does not have is also an error.
  const r2 = resolveExtends(
    { name: 'child', extends: 'base', node_overrides: { zzz: { model: 'haiku' } } },
    (n) => (n === 'base' ? base : undefined),
  );
  expect(r2.errors[0]!.message).toContain('override names no node "zzz"');
  // A cycle is caught rather than recursing forever.
  const loop = { name: 'loop', extends: 'loop', nodes: [] };
  expect(resolveExtends(loop, () => loop).errors[0]!.message).toContain('extends cycle');
}

function mixedMatchesBaseExceptModels(): void {
  const { workflows, errors } = discoverWorkflows(os.tmpdir());
  expect(errors).toEqual([]);
  const get = (name: string) => workflows.find((w) => w.workflow.name === name)!.workflow;
  const mixed = get('spec-implement-mixed');
  const impl = get('spec-implement');
  const strip = (n: Record<string, unknown>) => {
    const { model: _m, ...rest } = n;
    return rest;
  };
  expect(mixed.nodes.map((n) => strip(n as unknown as Record<string, unknown>))).toEqual(
    impl.nodes.map((n) => strip(n as unknown as Record<string, unknown>)),
  );
  const models = Object.fromEntries(
    (mixed.nodes as unknown as Array<{ id: string; model?: string }>).filter((n) => n.model).map((n) => [n.id, n.model]),
  );
  expect(models).toEqual({
    fetch_spec: 'haiku',
    plan: 'sonnet',
    implement: 'haiku',
    fix_quality: 'haiku',
    link: 'haiku',
    adversarial_review: 'sonnet',
  });
  // Shared top-level guidance is inherited (it had drifted when duplicated).
  expect((mixed as unknown as { systemPromptAppend?: string }).systemPromptAppend).toBe(
    (impl as unknown as { systemPromptAppend?: string }).systemPromptAppend,
  );
}

describe('workflow extends (REQ-THRU-004)', () => {
  it('a workflow extending another inherits nodes and applies overrides (REQ-THRU-004.A1)', extendsInheritsAndOverrides);
  it('extending an unknown workflow is a load error (REQ-THRU-004.A2)', unknownBaseIsAnError);
  it('spec-implement-mixed equals spec-implement except its models (REQ-THRU-004.A3)', mixedMatchesBaseExceptModels);
});
