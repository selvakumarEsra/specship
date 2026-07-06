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
  specId: string;
  kind: string;
  state: string;
  targetFilePath?: string;
  targetQualifiedName?: string;
  driftAxis?: string | null;
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

export type RunAction = 'approve' | 'reject' | 'cancel' | 'resume';

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

/** One row from GET /api/claude/prompts/recent (text capped at 200 chars). */
export interface RecentPrompt {
  id: string;
  session_id: string;
  text: string;
  ts: number;
}

export interface RecentPromptsResponse {
  prompts: RecentPrompt[];
}

// ---- Claude analytics shapes (server/src/routes/claude.ts) ----

/** One dashboard stat-tile metric: value + WoW delta + 7-point sparkline. */
export interface StatMetric {
  value: number;
  delta: number;
  series: number[];
}

export interface ClaudeStatsResponse {
  lastSessionCost: StatMetric;
  toolCalls: StatMetric;
  subagentPct: StatMetric;
  drift: StatMetric;
  /** Total ingested sessions; 0 = nothing ingested (REQ-DESKTOP-020.A4). */
  sessionCount: number;
}

/** One row from /api/claude/costs topPrompts (text capped at 200 chars). */
export interface CostPrompt {
  id: string;
  session_id: string;
  text: string;
  model: string | null;
  cost_usd: number;
  is_sidechain: number;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  ts: number;
}

export interface ClaudeCostsResponse {
  total: number;
  topPrompts: CostPrompt[];
  series: Array<{ day: number; cost: number; prompts: number }>;
  byModel: Array<{ model: string; prompts: number; cost: number }>;
  wowDelta: number;
}

export interface ClaudeCacheResponse {
  readRate: number;
  creationTokens: number;
  readTokens: number;
  inputTokens: number;
  outputTokens: number;
  totalCost: number;
  dollarsSaved: number;
  wowDelta: number;
}

export interface HeatmapFile {
  path: string;
  calls: number;
  resultBytes: number | null;
  trend: number[];
}

export interface ClaudeHeatmapResponse {
  files: HeatmapFile[];
  tools: Array<{ name: string; calls: number; resultBytes: number | null }>;
  subagents: Array<{ type: string; prompts: number; tokens: number; cost: number }>;
  subagentByName: Array<{ name: string; calls: number; firstSeen: number; lastSeen: number }>;
}

export interface ClaudeTip {
  id: string;
  severity: 'error' | 'warn' | 'info';
  icon: string;
  title: string;
  why: string;
  evidence: { session: string; detail: string };
  fix: string;
  saving: string;
  /** Set when the tip was applied; dismissed tips never come back at all. */
  state?: 'applied';
}

export interface ClaudeTipsResponse {
  tips: ClaudeTip[];
}

export interface ClaudeSession {
  id: string;
  project_path: string;
  started_at: number | null;
  ended_at: number | null;
  total_cost_usd: number | null;
  prompt_count: number | null;
  last_model: string | null;
  total_input_tokens?: number;
  total_output_tokens?: number;
  total_cache_creation_tokens?: number;
  total_cache_read_tokens?: number;
  [key: string]: unknown;
}

export interface ClaudeSessionsResponse {
  sessions: ClaudeSession[];
}

/** One claude_prompts row from /api/claude/session/:id (+ derived duration). */
export interface ClaudePrompt {
  id: string;
  session_id: string;
  text: string | null;
  ts: number;
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  cost_usd: number;
  is_sidechain: number;
  durationMs?: number;
  [key: string]: unknown;
}

/** One claude_tool_calls row from /api/claude/session/:id. */
export interface ClaudeToolCall {
  prompt_id: string | null;
  session_id: string;
  tool_name: string;
  input_summary: string;
  result_length: number | null;
  ts: number;
  [key: string]: unknown;
}

export interface ClaudeSessionDetailResponse {
  session: ClaudeSession;
  prompts: ClaudePrompt[];
  toolCalls: ClaudeToolCall[];
}

/** GET /api/claude/session/:id/summary — the Session Detail summary rail. */
export interface ClaudeSessionSummaryResponse {
  sessionId: string;
  byTool: Array<{ name: string; calls: number; totalBytes: number }>;
  byModel: Array<{ model: string; prompts: number; cost: number }>;
  slashCommands: Array<{ name: string; count: number }>;
  skills: Array<{ name: string; count: number }>;
  filesTouched: Array<{ path: string; ops: number; lastOp: string }>;
  durationMs: number;
  specship: { spendTokens: number; savedTokens: number; netTokens: number };
}

/** One row from GET /api/claude/projects — Claude-cost projects (by cwd). */
export interface ClaudeProject {
  path: string;
  name: string;
  sessions: number;
  cost: number;
  prompts: number;
  [key: string]: unknown;
}

export interface ClaudeProjectsResponse {
  projects: ClaudeProject[];
}

/** One row from GET /api/claude/compare — per-project cost comparison. */
export interface ClaudeCompareProject {
  path: string;
  name: string;
  sessions: number;
  cost: number;
  avgCost: number;
  prompts: number;
  cacheHit: number;
  drift: number;
  byModel: Array<{ model: string; cost: number }>;
  topTools: string[];
  [key: string]: unknown;
}

export interface ClaudeCompareResponse {
  projects: ClaudeCompareProject[];
}

// ---- Heatmap drill-downs (REQ-DESKTOP-024) ----

/** GET /api/claude/heatmap/file — sessions + tool split for one file path. */
export interface HeatmapFileDetail {
  path: string;
  sessions: Array<{ session_id: string; last_model: string | null; project_path: string | null; calls: number; bytes: number; lastTs: number; firstTs: number }>;
  byTool: Array<{ name: string; calls: number; bytes: number }>;
}

/** GET /api/claude/heatmap/tool — totals + top inputs for one tool. */
export interface HeatmapToolDetail {
  tool: string;
  totals: { calls: number; bytes: number; sessions: number };
  inputs: Array<{ input: string; calls: number; bytes: number; lastTs: number }>;
  recentSessions: Array<{ session_id: string; last_model: string | null; project_path: string | null; calls: number; lastTs: number }>;
}

/** GET /api/claude/heatmap/subagent — invocations of one subagent_type. */
export interface HeatmapSubagentDetail {
  subagent: string;
  totals: { calls: number; sessions: number };
  invocations: Array<{ session_id: string; ts: number; description: string; prompt: string; last_model: string | null }>;
}

export interface SpecshipImpactResponse {
  spendTokens: number;
  savedTokens: number;
  netTokens: number;
  [key: string]: unknown;
}

// ---- Memory (server/src/routes/memory.ts, REQ-DESKTOP-025) ----

export type MemoryLevel = 'enterprise' | 'user' | 'project' | 'subdir' | 'import' | 'note';
export type MemoryType = 'instruction' | 'note' | 'import';

/** One memory source: a CLAUDE.md tier, an @path import, or a saved note. */
export interface MemoryFile {
  id: string;
  level: MemoryLevel;
  type: MemoryType;
  name: string;
  scope: string;
  path: string;
  tokens: number;
  lines: number;
  modified: string;
  body: string;
  readOnly?: boolean;
  /** ids of the import files this instruction file pulls in via @path. */
  imports?: string[];
  session?: string;
  tags?: string[];
}

/** GET /api/memory — files arrive in Claude Code's load order. */
export interface MemoryResponse {
  totalTokens: number;
  instructionCount: number;
  noteCount: number;
  importCount: number;
  files: MemoryFile[];
}

// ---- MCP servers (server/src/routes/mcp.ts, REQ-DESKTOP-026) ----

/** Spec vocabulary — see the route's deriveState precedence. */
export type McpServerState = 'active' | 'connected' | 'idle' | 'failed' | 'disabled';

export interface McpServerTool {
  name: string;
  calls: number;
  resultBytes: number;
}

/** Latest real call from claude_tool_calls (input_json); args {} = fallback. */
export interface McpExampleCall {
  tool: string;
  args: Record<string, unknown>;
}

export interface McpServer {
  id: string;
  name: string;
  /** 'unknown' = seen in transcripts but not in any config file. */
  scope: 'user' | 'project' | 'unknown';
  state: McpServerState;
  transport: 'stdio' | 'http';
  command: string;
  /** Owning config file path; null for usage-only servers. */
  configFile: string | null;
  disabled: boolean;
  /** The raw config entry, for the detail panel's config JSON. */
  entry: Record<string, unknown> | null;
  calls: number;
  resultBytes: number;
  lastUsed: string | null;
  tools: McpServerTool[];
  exampleCall: McpExampleCall | null;
}

export interface McpServersResponse {
  servers: McpServer[];
}

export interface AddMcpServerPayload {
  name: string;
  scope: 'user' | 'project';
  command?: string;
  args?: string[];
  url?: string;
}

// ---- Runtime config (server/src/routes/config.ts, REQ-DESKTOP-028) ----

/** GET/PUT /api/config — the server's dashboard-editable runtime knobs. */
export interface ConfigResponse {
  /** Claude Code transcript-ingest toggle (persisted server-side). */
  ingestEnabled: boolean;
  /** Real product version (@specship/specship). */
  version: string;
}

// ---- Chat (server/src/routes/chat.ts + chat-answer.ts, REQ-DESKTOP-027) ----

/** Pointer to one graph symbol inside a chat source's detail. */
export interface ChatSymbolRef {
  name: string;
  qualifiedName: string;
  filePath: string;
  line: number;
}

/** Full retrieved detail for a symbol source — verbatim body + 1-hop trail. */
export interface ChatSymbolDetail {
  signature?: string;
  body: string;
  callers: ChatSymbolRef[];
  callees: ChatSymbolRef[];
}

/** Full detail for a spec source: verbatim body + its links with states. */
export interface ChatSpecDetail {
  body: string;
  links: Array<{ target: string; state: string }>;
}

/** Full detail for a domain-fact source. */
export interface ChatDomainDetail {
  body: string;
}

/** The `detail` payload on a ChatSource, discriminated by the source's `kind`. */
export type ChatSourceDetail = ChatSymbolDetail | ChatSpecDetail | ChatDomainDetail;

/** One indexed row the answer was derived from (chat-answer.ts ChatSource). */
export interface ChatSource {
  kind: 'symbol' | 'spec' | 'domain';
  ref: string;
  label: string;
  filePath?: string;
  line?: number;
  detail?: ChatSourceDetail;
}

/** POST /api/chat — the fully-composed deterministic answer. */
export interface ChatResponse {
  found: boolean;
  answer: string;
  sources: ChatSource[];
}

// ---- API surface ----

export const api = {
  status: (project?: string | null) => getJson<StatusResponse>(q('/api/status', project)),
  refresh: (project?: string | null) => postJson<StatusResponse>(q('/api/refresh', project)),
  graphFull: (project?: string | null, limit = 250) =>
    getJson<GraphFullResponse>(q(`/api/graph/full?limit=${limit}`, project)),
  graphNode: (id: string, project?: string | null) =>
    getJson<GraphNodeResponse>(q(`/api/graph/node?id=${encodeURIComponent(id)}`, project)),
  graphHealth: (project?: string | null) =>
    getJson<GraphHealthResponse>(q('/api/graph/health', project)),
  specs: (project?: string | null) => getJson<SpecsResponse>(q('/api/specs', project)),
  spec: (id: string, project?: string | null) =>
    getJson<SpecDetailResponse>(q(`/api/spec/${encodeURIComponent(id)}`, project)),
  specSave: (id: string, content: string, project?: string | null) =>
    putJson<SpecSaveResponse>(q(`/api/spec/${encodeURIComponent(id)}`, project), { content }),
  drift: (project?: string | null) => getJson<DriftResponse>(q('/api/drift', project)),
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
  recentPrompts: (project?: string | null, limit = 20) =>
    getJson<RecentPromptsResponse>(q(`/api/claude/prompts/recent?limit=${limit}`, project)),
  // Claude analytics (REQ-DESKTOP-020/-024). These aggregate the cross-project
  // claude_* tables on the primary project's DB; the optional project/model
  // params narrow them (REQ-DESKTOP-024.A2). `project` here is a Claude
  // project path (or transcript-dir slug), not a specship project slug.
  claudeStats: (range = 'week') => getJson<ClaudeStatsResponse>(`/api/claude/stats?range=${range}`),
  claudeCosts: (range = 'week', project?: string | null, model?: string | null) =>
    getJson<ClaudeCostsResponse>(q(`/api/claude/costs?range=${range}${model ? `&model=${encodeURIComponent(model)}` : ''}`, project)),
  claudeCache: (range = 'week') => getJson<ClaudeCacheResponse>(`/api/claude/cache?range=${range}`),
  claudeHeatmap: (range = 'week', project?: string | null) =>
    getJson<ClaudeHeatmapResponse>(q(`/api/claude/heatmap?range=${range}`, project)),
  claudeHeatmapFile: (path: string, range = 'week') =>
    getJson<HeatmapFileDetail>(`/api/claude/heatmap/file?path=${encodeURIComponent(path)}&range=${range}`),
  claudeHeatmapTool: (name: string, range = 'week') =>
    getJson<HeatmapToolDetail>(`/api/claude/heatmap/tool?name=${encodeURIComponent(name)}&range=${range}`),
  claudeHeatmapSubagent: (type: string, range = 'week') =>
    getJson<HeatmapSubagentDetail>(`/api/claude/heatmap/subagent?type=${encodeURIComponent(type)}&range=${range}`),
  claudeTips: () => getJson<ClaudeTipsResponse>('/api/claude/tips'),
  setTipState: (id: string, state: 'applied' | 'dismissed') =>
    postJson<{ ok: boolean }>('/api/claude/tips/state', { id, state }),
  claudeSessions: (project?: string | null, limit = 10, range = 'week', model?: string | null) =>
    getJson<ClaudeSessionsResponse>(q(`/api/claude/sessions?limit=${limit}&range=${range}${model ? `&model=${encodeURIComponent(model)}` : ''}`, project)),
  claudeSession: (id: string) =>
    getJson<ClaudeSessionDetailResponse>(`/api/claude/session/${encodeURIComponent(id)}`),
  claudeSessionSummary: (id: string) =>
    getJson<ClaudeSessionSummaryResponse>(`/api/claude/session/${encodeURIComponent(id)}/summary`),
  claudeProjects: () => getJson<ClaudeProjectsResponse>('/api/claude/projects'),
  claudeCompare: () => getJson<ClaudeCompareResponse>('/api/claude/compare'),
  specshipImpact: (range = 'week') =>
    getJson<SpecshipImpactResponse>(`/api/claude/specship-impact?range=${range}`),
  ingestNow: () => postJson<{ ok: boolean }>('/api/claude/ingest'),
  memory: (project?: string | null) => getJson<MemoryResponse>(q('/api/memory', project)),
  mcpServers: () => getJson<McpServersResponse>('/api/mcp/servers'),
  setMcpServerEnabled: (name: string, enabled: boolean) =>
    patchJson<{ ok: boolean; name: string; disabled: boolean }>(`/api/mcp/servers/${encodeURIComponent(name)}`, { enabled }),
  addMcpServer: (payload: AddMcpServerPayload) =>
    postJson<{ ok: boolean; name: string }>('/api/mcp/servers', payload),
  chat: (question: string, project?: string | null) =>
    postJson<ChatResponse>(q('/api/chat', project), { question }),
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

/**
 * SSE stream URL for a chat answer (GET /api/chat/stream): `thinking` →
 * `tool` → `result_summary` → `chunk`… → `done`. The primary send path —
 * the `tool` event carries the tool-call context the answer renders
 * (REQ-DESKTOP-027.A2); `api.chat` is the non-stream fallback.
 */
export function chatStreamUrl(question: string, project?: string | null): string {
  return q(`/api/chat/stream?question=${encodeURIComponent(question)}`, project);
}
