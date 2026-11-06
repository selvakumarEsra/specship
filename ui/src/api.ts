/**
 * Same-origin fetch wrappers over the dashboard server's /api routes
 * (server/src/routes/*). The SPA is served by that same server —
 * no host, no port, no CORS (REQ-DESKTOP-017.A1): every call is a relative
 * URL against the app's own origin.
 */

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string | null,
    message: string,
  ) {
    super(message);
  }
}

/** 409 `no_project` — the server booted projectless; UI shows the picker. */
export function isNoProject(e: unknown): boolean {
  return e instanceof ApiError && e.status === 409 && e.code === 'no_project';
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    let code: string | null = null;
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { error?: string; code?: string };
      if (body.code) code = body.code;
      if (body.error) message = body.error;
    } catch { /* non-JSON error body */ }
    throw new ApiError(res.status, code, message);
  }
  return res.json() as Promise<T>;
}

const getJson = <T,>(path: string) => request<T>(path);
const postJson = <T,>(path: string, body?: unknown) =>
  request<T>(path, body === undefined
    ? { method: 'POST' }
    : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const putJson = <T,>(path: string, body: unknown) =>
  request<T>(path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const patchJson = <T,>(path: string, body: unknown) =>
  request<T>(path, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

/** Append `?project=<slug>` when a non-primary project is selected. */
function q(path: string, project?: string | null): string {
  if (!project) return path;
  return path + (path.includes('?') ? '&' : '?') + 'project=' + encodeURIComponent(project);
}

// ---- Response shapes (mirroring server/src/routes/*) ----

export interface StatusResponse {
  projectPath: string;
  backend: string;
  journalMode: string;
  /** Real product version (@specship/specship), for About (REQ-DESKTOP-028.A3). */
  version: string;
  nodeCount: number;
  edgeCount: number;
  fileCount: number;
  drift: number;
  lastIndexed: string | null;
  nodesByKind: Record<string, number>;
  filesByLanguage: Record<string, number>;
  dbSizeBytes: number;
}

export interface GraphNode {
  id: string;
  name: string;
  kind: string;
  filePath: string;
  degree: number;
}

export interface GraphEdge {
  from: string;
  to: string;
  kind: string;
  provenance: string;
}

export interface GraphFullResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
  total: number;
  shown: number;
}

/** A node as it appears inside /api/graph/node responses (no degree). */
export interface NodeRef {
  id: string;
  name: string;
  kind: string;
  filePath: string;
  startLine?: number;
  endLine?: number;
  signature?: string;
  docstring?: string;
  [key: string]: unknown;
}

/** One spec_links row attached to a node (src/types.ts SpecLink, camelCased). */
export interface LinkedSpec {
  /** spec_links row id — what POST /api/spec/link-verify takes. */
  id?: number;
  specId: string;
  kind: string;
  state: string;
  targetFilePath?: string;
  targetQualifiedName?: string;
  driftAxis?: string | null;
  /** What changed in a code drift (REQ-LINKACC-002): rename-only / type-change / shape-change / unclassified. */
  driftKind?: string | null;
  provenance?: string;
  resolvedNodeId?: string;
  updatedAt?: number;
  [key: string]: unknown;
}

/** One match from GET /api/graph/node — node + its caller/callee/spec context. */
export interface GraphNodeDetail extends NodeRef {
  callers: NodeRef[];
  callees: NodeRef[];
  linkedSpecs: LinkedSpec[];
  /** Verbatim source of the symbol's own body — only with `includeCode`. */
  code?: string | null;
  /** True when `code` was cut at the server's line cap. */
  codeTruncated?: boolean;
}

/** GET /api/graph/split-search — the split view's grouped matches (REQ-DASHSIMPLE-005). */
export interface SplitSearchResponse {
  specs: Array<{ id: string; title: string; kind: string; snippet: string }>;
  symbols: Array<{ id: string; name: string; kind: string; filePath: string; startLine?: number }>;
}

export interface GraphNodeResponse {
  matches: GraphNodeDetail[];
}

/** GET /api/graph/health — the Graph overview rail's data. */
export interface GraphHealthResponse {
  linkHealth: Record<string, number>;
  edgeKinds: Record<string, number>;
  hubs: GraphNode[];
  anchored: GraphNode[];
}

export interface SpecDoc {
  id: string;
  title: string;
  filePath?: string;
  state?: string;
  priority?: string;
  kind?: string;
  sourcePath?: string;
  parentId?: string;
  owner?: string;
  body?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface SpecsResponse {
  specs: SpecDoc[];
  linkStates: Record<string, string>;
}

/** GET /api/spec/:id — the full detail contract for one requirement. */
export interface SpecDetailResponse {
  spec: SpecDoc;
  parent: SpecDoc | null;
  siblings: SpecDoc[];
  children: SpecDoc[];
  links: LinkedSpec[];
  /** Per-child (acceptance criterion) links, for the N/M-met rollup. */
  childLinks: Record<string, LinkedSpec[]>;
  source: string | null;
}

// ---- Spec funnel + coverage (REQ-TVIZ-007/-008) ----

/** GET /api/spec/funnel — src/resolution/brief-link-resolver.ts SpecFunnel. */
export interface SpecFunnelResponse {
  summary: {
    ideas: number;
    specified: number;
    conflicts: number;
    documents: number;
    requirements: number;
    links: { implemented: number; verified: number; drifted: number; broken: number; orphaned: number };
  };
  documents: Array<{ id: string; title: string; rollup: Record<string, number> }>;
  ideas: Array<{ briefId: string; title: string; capturedAt: number | null; labels: string[] }>;
  conflicts: Array<{ briefId: string; briefSide: string | null; specSide: string | null }>;
}

/**
 * Test-coverage verdict for one spec node (src/graph/spec-coverage.ts).
 * Derived from `tests` links ONLY — an `implements`-only spec is `untested`.
 */
export type CoverageVerdict = 'untested' | 'tested' | 'verified' | 'broken';

export interface LinkRollup {
  count: number;
  states: Record<string, number>;
}

export interface CriterionCoverage {
  specId: string;
  title: string;
  kind: string;
  implementsLinks: LinkRollup;
  testsLinks: LinkRollup;
  /** Every other link kind; absent from servers older than REQ-LINKACC-007's fix. */
  otherLinks?: LinkRollup;
  verdict: CoverageVerdict;
}

export interface RequirementCoverage extends CriterionCoverage {
  criteria: CriterionCoverage[];
  criteriaTotals: Record<CoverageVerdict, number>;
  criteriaWithTests: number;
  criteriaCount: number;
}

/** GET /api/spec/coverage — the Wave 2 rollup both the matrix and the tree read. */
export interface SpecCoverageResponse {
  specId: string | null;
  requirements: RequirementCoverage[];
  totals: {
    requirements: number;
    criteria: number;
    criteriaWithTests: number;
    criteriaVerified: number;
    criteriaBroken: number;
  };
}

// ---- Plan reader (REQ-DASHSIMPLE-003) ----

/** A task: one acceptance criterion with its test-evidence verdict. */
export interface PlanTask {
  specId: string;
  title: string;
  verdict: CoverageVerdict;
}

/** A story: one requirement. `coverage` is raw — the client classifies it. */
export interface PlanStory {
  specId: string;
  title: string;
  body: string;
  jiraKey: string | null;
  coverage: RequirementCoverage | null;
  tasks: PlanTask[];
}

export interface PlanDoc {
  id: string;
  title: string;
  stories: PlanStory[];
}

/** An epic: documents sharing an `epicKey`, or one document with none (key null). */
export interface PlanEpic {
  key: string | null;
  title: string;
  docs: PlanDoc[];
}

/** GET /api/spec/plan. */
export interface PlanResponse {
  jiraBaseUrl: string | null;
  epics: PlanEpic[];
  /** Drift-state links — Review's classifier's second input. */
  driftLinks: DriftLink[];
}

/** POST /api/spec/link-verify — promote or fail one link. */
export interface LinkVerifyResponse {
  ok: boolean;
  state: string;
}

/** PUT /api/spec/:id — whole-file overwrite + re-sync (REQ-DESKTOP-011). */
export interface SpecSaveResponse {
  ok: boolean;
  spec: SpecDoc;
  /** Set when the write landed but the re-index pass failed. */
  syncError?: string;
}

/** One /api/drift row — a spread SpecLink plus its spec's title. */
export interface DriftLink {
  specId: string;
  state: string;
  specTitle: string | null;
  targetFilePath?: string;
  targetQualifiedName?: string;
  driftAxis?: string | null;
  /** What changed in a code drift (REQ-LINKACC-002). */
  driftKind?: string | null;
  provenance?: string;
  resolvedNodeId?: string;
  updatedAt?: number;
  [key: string]: unknown;
}

export interface DriftResponse {
  links: DriftLink[];
}

export interface WorkflowRun {
  id: string;
  workflowId?: string;
  workflowName?: string;
  status: string;
  startedAt?: string | number | null;
  completedAt?: string | number | null;
  finishedAt?: string | number | null;
  errorMessage?: string;
  /** Run-level metadata: nodeStates, approval context, outputs (executor-owned). */
  metadata?: Record<string, unknown>;
  /** List-level stats roll-up (null on runs recorded before stats existed). */
  totalCostUsd?: number | null;
  model?: string | null;
  eta?: unknown;
  [key: string]: unknown;
}

/**
 * The coding agent a run executed on, exactly as the executor recorded it at
 * `metadata.agent` (src/workflows/agents RUN_AGENT_KEY). Null when the run has
 * none — never a guessed default (REQ-DASHSIMPLE-002.A2).
 */
// @implements REQ-DASHSIMPLE-002
export function runAgentName(run: WorkflowRun): string | null {
  const agent = run.metadata?.agent;
  return typeof agent === 'string' && agent.trim() ? agent : null;
}

export interface RunsResponse {
  runs: WorkflowRun[];
}

// ---- Workflows + run detail (REQ-DESKTOP-023) ----

/** One DAG node of a workflow definition (src/workflows/schemas/workflow.ts). */
export interface WorkflowDagNode {
  id: string;
  kind: string;
  depends_on?: string[];
  output_type?: string;
  [key: string]: unknown;
}

export interface WorkflowDefinition {
  name: string;
  description?: string;
  requires?: string[];
  inputs?: Array<{ name: string; description?: string; required?: boolean; default?: string }>;
  nodes: WorkflowDagNode[];
  [key: string]: unknown;
}

/** GET /api/workflows — discovery result (bundled/global/project precedence). */
export interface WorkflowsResponse {
  workflows: Array<{ workflow: WorkflowDefinition; scope: string; sourcePath: string }>;
  errors: Array<{ scope: string; sourcePath: string; errors: unknown[] }>;
}

/** One workflow_events row (src/types.ts WorkflowEvent). */
export interface RunEvent {
  id: number;
  workflowRunId: string;
  eventType: string;
  stepId?: string;
  stepKind?: string;
  data?: Record<string, unknown>;
  createdAt: number;
}

/** GET /api/workflows/runs/:id — run row + its event log. */
export interface RunDetailResponse {
  run: WorkflowRun;
  events: RunEvent[];
}

export interface RunArtifact {
  nodeId: string;
  name: string;
  kind?: string;
  outputType?: string;
  length: number;
  body: string;
}

export interface RunArtifactsResponse {
  artifacts: RunArtifact[];
}

export type RunAction = 'approve' | 'reject' | 'cancel' | 'resume' | 'purge';

export interface ProjectEntry {
  slug: string;
  path: string;
  exists: boolean;
  initialized: boolean;
  sessionCount: number;
  lastModifiedMs: number;
  /** Drifted/broken/orphaned spec-link count; null/absent = unknown. */
  driftCount?: number | null;
}

export interface ProjectsResponse {
  claudeRoot: string;
  projects: ProjectEntry[];
}

/** One hit from GET /api/graph/search — a scored node match. */
export interface SearchResult {
  node: GraphNode & { startLine?: number; endLine?: number };
  score?: number;
  [key: string]: unknown;
}

export interface SearchResponse {
  results: SearchResult[];
}

// ---- Runtime config (server/src/routes/config.ts, REQ-DESKTOP-028) ----

/** GET/PUT /api/config — the server's dashboard-editable runtime knobs. */
export interface ConfigResponse {
  /** Claude Code transcript-ingest toggle (persisted server-side). */
  ingestEnabled: boolean;
  /** Real product version (@specship/specship). */
  version: string;
}

// ---- API surface ----

export const api = {
  status: (project?: string | null) => getJson<StatusResponse>(q('/api/status', project)),
  refresh: (project?: string | null) => postJson<StatusResponse>(q('/api/refresh', project)),
  graphFull: (project?: string | null, limit = 250) =>
    getJson<GraphFullResponse>(q(`/api/graph/full?limit=${limit}`, project)),
  graphNode: (id: string, project?: string | null, opts: { includeCode?: boolean } = {}) =>
    getJson<GraphNodeResponse>(q(`/api/graph/node?id=${encodeURIComponent(id)}${opts.includeCode ? '&includeCode=1' : ''}`, project)),
  // One search box over specs + code symbols (REQ-DASHSIMPLE-005).
  splitSearch: (qs: string, project?: string | null) =>
    getJson<SplitSearchResponse>(q(`/api/graph/split-search?q=${encodeURIComponent(qs)}`, project)),
  graphHealth: (project?: string | null) =>
    getJson<GraphHealthResponse>(q('/api/graph/health', project)),
  specs: (project?: string | null) => getJson<SpecsResponse>(q('/api/specs', project)),
  spec: (id: string, project?: string | null) =>
    getJson<SpecDetailResponse>(q(`/api/spec/${encodeURIComponent(id)}`, project)),
  specSave: (id: string, content: string, project?: string | null) =>
    putJson<SpecSaveResponse>(q(`/api/spec/${encodeURIComponent(id)}`, project), { content }),
  specFunnel: (project?: string | null) => getJson<SpecFunnelResponse>(q('/api/spec/funnel', project)),
  // Scoped to one spec with `spec`, or the whole project when omitted.
  specCoverage: (spec?: string | null, project?: string | null) =>
    getJson<SpecCoverageResponse>(q('/api/spec/coverage' + (spec ? `?spec=${encodeURIComponent(spec)}` : ''), project)),
  // Epic → story → task for the Plan reader (REQ-DASHSIMPLE-003).
  specPlan: (project?: string | null) => getJson<PlanResponse>(q('/api/spec/plan', project)),
  // Promote (`pass`) or fail a link. A `pass` on an `implements` link with no
  // test evidence comes back 409 / `no_test_evidence` (REQ-TVIZ-009.A1).
  linkVerify: (
    body: { link_id: number; result: 'pass' | 'fail'; reason?: string; evidence?: string[] },
    project?: string | null,
  ) => postJson<LinkVerifyResponse>(q('/api/spec/link-verify', project), body),
  // Review passes its states explicitly (and the server's max limit) so the
  // screen never depends on the route's default filter (REQ-DASHSIMPLE-004).
  drift: (project?: string | null, opts: { states?: readonly string[]; limit?: number } = {}) => {
    const p = new URLSearchParams();
    if (opts.states?.length) p.set('state', opts.states.join(','));
    if (opts.limit) p.set('limit', String(opts.limit));
    const qs = p.toString();
    return getJson<DriftResponse>(q('/api/drift' + (qs ? '?' + qs : ''), project));
  },
  runs: (project?: string | null) => getJson<RunsResponse>(q('/api/workflows/runs', project)),
  workflows: (project?: string | null) => getJson<WorkflowsResponse>(q('/api/workflows', project)),
  launchRun: (workflowName: string, inputs: Record<string, string>, project?: string | null) =>
    postJson<{ runId: string; status: string }>(q('/api/workflows/runs', project), { workflowName, inputs }),
  run: (id: string, project?: string | null) =>
    getJson<RunDetailResponse>(q(`/api/workflows/runs/${encodeURIComponent(id)}`, project)),
  runArtifacts: (id: string, project?: string | null) =>
    getJson<RunArtifactsResponse>(q(`/api/workflows/runs/${encodeURIComponent(id)}/artifacts`, project)),
  runAction: (id: string, action: RunAction, body?: { comment?: string; reason?: string }, project?: string | null) =>
    postJson<{ ok: boolean }>(q(`/api/workflows/runs/${encodeURIComponent(id)}/${action}`, project), body),
  projects: () => getJson<ProjectsResponse>('/api/projects'),
  graphSearch: (qs: string, project?: string | null, limit = 10) =>
    getJson<SearchResponse>(q(`/api/graph/search?q=${encodeURIComponent(qs)}&limit=${limit}`, project)),
  // Server runtime config (REQ-DESKTOP-028.A2): the Settings ingest toggle
  // round-trips through these; analytics screens read `get` to react.
  config: {
    get: () => getJson<ConfigResponse>('/api/config'),
    set: (body: { ingestEnabled: boolean }) => putJson<ConfigResponse>('/api/config', body),
  },
};

/**
 * SSE stream URL for a run's live events (EventSource takes a URL, not a
 * fetch). `since` skips events already fetched via api.run.
 */
export function runEventsUrl(id: string, since?: number, project?: string | null): string {
  const base = `/api/workflows/runs/${encodeURIComponent(id)}/events${since ? `?since=${since}` : ''}`;
  return q(base, project);
}

