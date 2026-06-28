/**
 * Behaviour surface (REQ-BEHAVIOUR-001).
 *
 * Given a requirement, surface the code it links to PLUS the routes /
 * components / handlers around it, partitioned into a UI tier and a
 * backend/batch tier — the precise flow map the `/ss-behaviour` skill turns into
 * end-to-end tests, without having to re-explore the codebase.
 *
 * `computeBehaviourSurface` is a pure function over a `deps` snapshot so it is
 * testable without a database; `SpecShip.getBehaviourSurface()` assembles the
 * snapshot (requirement + acceptance children → their linked nodes → the
 * 1-hop caller/callee neighbourhood) and calls it.
 *
 * Tier classification is structural: the graph carries no framework marker on a
 * node, so UI is inferred from `kind === 'component'` or a front-end file
 * extension; everything else flow-relevant (routes, handlers) is backend/batch.
 */

import { Node, NodeKind } from '../types';

/** Node kinds that are flow-relevant for a behaviour test (others are noise). */
const FLOW_KINDS: ReadonlySet<NodeKind> = new Set<NodeKind>([
  'component',
  'route',
  'function',
  'method',
]);

/** File extensions that are unambiguously front-end / UI. */
const UI_FILE = /\.(tsx|jsx|vue|svelte|astro)$/i;

export interface BehaviourFlowElement {
  /** Qualified name (falls back to the simple name). */
  name: string;
  kind: NodeKind;
  filePath: string;
  startLine: number;
  /** True when the requirement links to this node directly (vs a neighbour). */
  linkedDirectly: boolean;
}

export interface BehaviourSurface {
  requirementId: string;
  /** False when the requirement id resolves to no spec (REQ-BEHAVIOUR-001.A4). */
  found: boolean;
  /** UI flows — Playwright targets. Empty when the project has no UI (A3). */
  ui: BehaviourFlowElement[];
  /** Backend / batch flows — API / job test targets. */
  backend: BehaviourFlowElement[];
}

export interface BehaviourSurfaceDeps {
  requirementId: string;
  /** Null when the requirement id resolved to no spec. */
  requirementExists: boolean;
  /** Resolved nodes the requirement (or its acceptance children) links to. */
  linkedNodes: Node[];
  /** 1-hop caller/callee neighbours of the linked nodes. */
  neighbourNodes: Node[];
}

/** A node is UI when it's a component or lives in a front-end file. */
export function isUiNode(node: Node): boolean {
  return node.kind === 'component' || UI_FILE.test(node.filePath);
}

function toElement(node: Node, linkedDirectly: boolean): BehaviourFlowElement {
  return {
    name: node.qualifiedName || node.name,
    kind: node.kind,
    filePath: node.filePath,
    startLine: node.startLine,
    linkedDirectly,
  };
}

/**
 * Build the behaviour surface for a requirement (REQ-BEHAVIOUR-001). Linked
 * nodes are always included (the implementation); neighbours are included only
 * when flow-relevant (routes / components / handlers — A1). Each element carries
 * its symbol, kind, and file location (A2). A requirement that resolves to no
 * spec returns `found: false` (A4); a project with no UI yields an empty `ui`
 * tier rather than an error (A3).
 */
export function computeBehaviourSurface(deps: BehaviourSurfaceDeps): BehaviourSurface {
  if (!deps.requirementExists) {
    return { requirementId: deps.requirementId, found: false, ui: [], backend: [] };
  }

  const seen = new Set<string>();
  const ui: BehaviourFlowElement[] = [];
  const backend: BehaviourFlowElement[] = [];

  const place = (node: Node, linkedDirectly: boolean): void => {
    if (seen.has(node.id)) return;
    seen.add(node.id);
    const el = toElement(node, linkedDirectly);
    (isUiNode(node) ? ui : backend).push(el);
  };

  // Linked nodes first (the implementation) — always included regardless of kind.
  for (const node of deps.linkedNodes) place(node, true);
  // Neighbours — only the flow-relevant kinds, and only if not already linked.
  for (const node of deps.neighbourNodes) {
    if (FLOW_KINDS.has(node.kind)) place(node, false);
  }

  // Directly-linked elements sort ahead of neighbours, then by file.
  const order = (a: BehaviourFlowElement, b: BehaviourFlowElement): number =>
    Number(b.linkedDirectly) - Number(a.linkedDirectly) ||
    a.filePath.localeCompare(b.filePath) ||
    a.startLine - b.startLine;
  ui.sort(order);
  backend.sort(order);

  return { requirementId: deps.requirementId, found: true, ui, backend };
}

/** Render a behaviour surface as markdown for the `specship_spec` response. */
export function renderBehaviourSurface(surface: BehaviourSurface): string {
  if (!surface.found) {
    return `# Behaviour surface — ${surface.requirementId}\n\n_Requirement "${surface.requirementId}" not found. Use specship_spec (query mode) or specship_drifted to discover requirements._`;
  }

  const lines: string[] = [];
  lines.push(`# Behaviour surface — ${surface.requirementId}`);
  lines.push('');
  lines.push(
    'The routes / components / handlers around this requirement, grouped by tier. ' +
      'Author a Playwright test per UI flow and an API/batch test per backend flow, ' +
      'one per acceptance criterion.'
  );
  lines.push('');

  const section = (title: string, els: BehaviourFlowElement[], emptyNote: string): void => {
    lines.push(`## ${title}`);
    if (els.length === 0) {
      lines.push(`_${emptyNote}_`);
    } else {
      for (const e of els) {
        const tag = e.linkedDirectly ? 'linked' : 'nearby';
        lines.push(`- [${e.kind}] \`${e.name}\` — ${e.filePath}:${e.startLine} (${tag})`);
      }
    }
    lines.push('');
  };

  section('UI tier (Playwright)', surface.ui, 'No UI surface — author backend/batch tests only.');
  section('Backend / batch tier', surface.backend, 'No backend surface found.');
  return lines.join('\n').trimEnd();
}
