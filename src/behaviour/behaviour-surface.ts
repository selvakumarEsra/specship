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

/** How an acceptance criterion is best tested (REQ-QGATE-001). */
export type CriterionTestShape = 'example' | 'invariant';

export interface ClassifiedCriterion {
  id: string;
  text: string;
  testShape: CriterionTestShape;
}

export interface BehaviourSurface {
  requirementId: string;
  /** False when the requirement id resolves to no spec (REQ-BEHAVIOUR-001.A4). */
  found: boolean;
  /** UI flows — Playwright targets. Empty when the project has no UI (A3). */
  ui: BehaviourFlowElement[];
  /** Backend / batch flows — API / job test targets. */
  backend: BehaviourFlowElement[];
  /** Acceptance criteria classified example|invariant (REQ-QGATE-001.A1). */
  criteria: ClassifiedCriterion[];
  /**
   * Contract-fuzz eligibility (REQ-QGATE-003.A1): a spec whose DIRECT links
   * include `route`-kind nodes describes an API contract and can be fuzzed
   * from the OpenAPI schema. Neighbour routes don't qualify — the fuzz run
   * must target only what the requirement actually links to (A2).
   */
  contractFuzz: { eligible: boolean; routes: BehaviourFlowElement[] };
}

export interface BehaviourSurfaceDeps {
  requirementId: string;
  /** Null when the requirement id resolved to no spec. */
  requirementExists: boolean;
  /** Resolved nodes the requirement (or its acceptance children) links to. */
  linkedNodes: Node[];
  /** 1-hop caller/callee neighbours of the linked nodes. */
  neighbourNodes: Node[];
  /** Acceptance criteria (id + bullet text) for shape classification. */
  criteria?: Array<{ id: string; text: string }>;
}

/**
 * Classify a criterion's test shape (REQ-QGATE-001.A1) — deterministic
 * keyword/shape heuristic, no LLM. Invariant cues are universal quantifiers
 * and negative universals ("for all", "every", "never", "always", "MUST
 * NOT"), plus the classic property shapes (round-trip, idempotence,
 * input-independence). Everything else is an example: a concrete
 * stimulus→response pair.
 */
export function classifyCriterionShape(text: string): CriterionTestShape {
  const t = text.toLowerCase();
  const cues: RegExp[] = [
    /\bfor (all|every|any)\b/,
    /\b(every|any) (input|request|value|call|x)\b/,
    /\bnever\b/,
    /\balways\b/,
    /\bmust not\b/,
    /\bround-?trip\b/,
    /\bidempotent\b/,
    /\bregardless of\b/,
    /\bno matter\b/,
    /\barbitrary\b/,
  ];
  return cues.some((re) => re.test(t)) ? 'invariant' : 'example';
}

/**
 * The property-testing framework the generated skeleton should use
 * (REQ-QGATE-001.A2), picked from the linked implementation's file types:
 * Python → Hypothesis, everything else (this tool's world is JS/TS) →
 * fast-check.
 */
export function propertyFramework(linkedNodes: Node[]): string {
  const py = linkedNodes.some((n) => /\.pyi?$/i.test(n.filePath));
  return py ? 'Hypothesis (@given)' : 'fast-check';
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
    return {
      requirementId: deps.requirementId, found: false, ui: [], backend: [], criteria: [],
      contractFuzz: { eligible: false, routes: [] },
    };
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

  const criteria: ClassifiedCriterion[] = (deps.criteria ?? []).map((c) => ({
    id: c.id,
    text: c.text,
    testShape: classifyCriterionShape(c.text),
  }));

  const routes = [...ui, ...backend].filter((e) => e.kind === 'route' && e.linkedDirectly);
  return {
    requirementId: deps.requirementId, found: true, ui, backend, criteria,
    contractFuzz: { eligible: routes.length > 0, routes },
  };
}

/**
 * The reviewable Schemathesis invocation for a route-backed spec
 * (REQ-QGATE-003.A2) — scoped to the linked routes via a path regex, never
 * the whole API. Emitted as text for a human/agent to review and run; this
 * module executes nothing.
 */
export function renderContractFuzzCommand(routes: BehaviourFlowElement[], schemaRef: string): string {
  const paths = routes.map((r) => {
    // Route names carry an optional method prefix ("GET /api/users") —
    // extract the path and normalize `{id}`/`:id` params to a wildcard
    // BEFORE regex-escaping the literal segments.
    const path = (r.name.match(/\/\S*/) ?? [r.name])[0];
    return path
      .split(/\{[^}]+\}|:\w+/)
      .map((seg) => seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('[^/]+');
  });
  const regex = `^(${[...new Set(paths)].join('|')})$`;
  return `st run ${schemaRef} --include-path-regex '${regex}' --checks all`;
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

  // Property lane (REQ-QGATE-001): classified criteria with the directive for
  // invariant-shaped ones. Rendered only when criteria were supplied, so the
  // pre-existing surface output is unchanged for callers that don't pass them.
  if (surface.criteria.length > 0) {
    const fw = propertyFramework([...surface.backend, ...surface.ui].filter((e) => e.linkedDirectly)
      .map((e) => ({ filePath: e.filePath }) as Node));
    lines.push('## Acceptance criteria — test shape');
    for (const c of surface.criteria) {
      lines.push(`- ${c.id} [${c.testShape}] — ${c.text}`);
    }
    if (surface.criteria.some((c) => c.testShape === 'invariant')) {
      lines.push('');
      lines.push(
        `_Author each **invariant** criterion as a property-based test with ${fw} — ` +
          'generate inputs, assert the stated property; do not hard-code a single example. ' +
          'Example-shaped criteria stay concrete example tests._'
      );
    }
    lines.push('');
  }

  // Contract-fuzz leg (REQ-QGATE-003): emitted as a reviewable command for the
  // linked routes — review the schema ref and run it yourself; nothing here
  // executes it.
  if (surface.contractFuzz.eligible) {
    lines.push('## Contract-fuzz leg (Schemathesis)');
    lines.push('This requirement links to API route(s) — its input space is fuzzable from the OpenAPI schema:');
    for (const r of surface.contractFuzz.routes) {
      lines.push(`- [route] \`${r.name}\` — ${r.filePath}:${r.startLine}`);
    }
    lines.push('');
    lines.push('```bash');
    lines.push(renderContractFuzzCommand(surface.contractFuzz.routes, '<openapi-schema (path or URL)>'));
    lines.push('```');
    lines.push('');
    lines.push(
      '_Review before running (staging only). Record the outcome through link verification: ' +
        'a failing run → result "fail" with the failing case as reason; a passing run is ' +
        'evidence under the existing rules — it does not mint tests-kind links._'
    );
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}
