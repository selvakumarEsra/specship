/**
 * Response types for every specship HTTP endpoint the UI consumes.
 * Mirror the shapes the Fastify routes return (see packages/server/src/routes/).
 */

export interface StatusResponse {
  projectPath: string;
  backend: string;
  journalMode: string;
  nodeCount: number;
  edgeCount: number;
  fileCount: number;
  drift: number;
  lastIndexed: string | null;
  nodesByKind: Record<string, number>;
  filesByLanguage: Record<string, number>;
  dbSizeBytes: number;
}

export interface ClaudeProject {
  path: string;
  name: string;
  first_seen: number;
  last_seen: number;
  sessions: number;
  cost: number;
  cacheRead: number;
  totalInput: number;
  prompts: number;
}

export interface ClaudeSession {
  id: string;
  project_path: string;
  source_file: string;
  started_at: number;
  ended_at: number;
  prompt_count: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cache_creation_tokens: number;
  total_cache_read_tokens: number;
  total_cost_usd: number;
  last_model: string | null;
}

export interface ClaudePrompt {
  id: string;
  session_id: string;
  text: string;
  ts: number;
  leaf_uuid: string | null;
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  cost_usd: number;
  is_sidechain: 0 | 1;
  /** Wall-clock duration of this prompt turn (gap to the next prompt), ms. Session-detail only. */
  durationMs?: number;
  /** Concatenated assistant text blocks (schema v7+). NULL on older rows. */
  assistant_text?: string | null;
  /** Concatenated extended-thinking blocks (schema v7+). NULL on older rows. */
  thinking_text?: string | null;
}

export interface ClaudeToolCall {
  id: number;
  prompt_id: string;
  session_id: string;
  assistant_uuid: string;
  tool_use_id: string | null;
  tool_name: string;
  input_summary: string | null;
  /** Verbatim JSON-stringified tool input (schema v7+). NULL on older rows. */
  input_json?: string | null;
  result_length: number;
  ts: number;
  /** 1 if this call is a SpecShip MCP tool call, 0 otherwise. */
  is_specship?: number;
  /** JSON-encoded displaced file paths+sizes: `[[path, size], …]` or NULL. */
  displaced_files?: string | null;
  /** 'resolved' | 'unresolved' | 'n/a' | NULL — SpecShip query resolution status. */
  resolution?: string | null;
}

export interface SessionsResponse {
  sessions: ClaudeSession[];
}

export interface SessionDetailResponse {
  session: ClaudeSession;
  prompts: ClaudePrompt[];
  toolCalls: ClaudeToolCall[];
}

/**
 * Rolled-up summary for the Session Detail "what did this session do" panel.
 * Returned by GET /api/claude/session/:id/summary. Cheap to recompute on
 * every page load — no caching needed.
 */
export interface SessionSummaryResponse {
  sessionId: string;
  byTool: Array<{ name: string; calls: number; totalBytes: number }>;
  byModel: Array<{ model: string; prompts: number; cost: number }>;
  slashCommands: Array<{ name: string; count: number }>;
  skills: Array<{ name: string; count: number }>;
  filesTouched: Array<{ path: string; ops: number; lastOp: string }>;
  durationMs: number;
  /** SpecShip token-impact rollup for this session. */
  specship?: {
    spendTokens: number;
    savedTokens: number;
    netTokens: number;
  };
}

export interface HeatmapResponse {
  files: Array<{ path: string; calls: number; resultBytes: number; trend?: number[] }>;
  tools: Array<{ name: string; calls: number; resultBytes: number }>;
  subagents: Array<{ type: 'main' | 'subagent'; prompts: number; tokens: number; cost: number }>;
  subagentByName: Array<{ name: string; calls: number; firstSeen: number; lastSeen: number }>;
}

export interface HeatmapFileDrillResponse {
  path: string;
  sessions: Array<{
    session_id: string;
    last_model: string | null;
    project_path: string | null;
    calls: number;
    bytes: number;
    firstTs: number;
    lastTs: number;
  }>;
  byTool: Array<{ name: string; calls: number; bytes: number }>;
}

export interface HeatmapToolDrillResponse {
  tool: string;
  totals: { calls: number; bytes: number; sessions: number };
  inputs: Array<{ input: string; calls: number; bytes: number; lastTs: number }>;
  recentSessions: Array<{
    session_id: string;
    last_model: string | null;
    project_path: string | null;
    calls: number;
    lastTs: number;
  }>;
}

export interface HeatmapSubagentDrillResponse {
  subagent: string;
  totals: { calls: number; sessions: number };
  invocations: Array<{
    session_id: string;
    ts: number;
    description: string;
    prompt: string;
    last_model: string | null;
  }>;
}

export interface CostsResponse {
  total: number;
  topPrompts: ClaudePrompt[];
  series: Array<{ day: number; cost: number; prompts: number }>;
  byModel: Array<{ model: string; prompts: number; cost: number }>;
  /** Fractional week-over-week change in total spend vs the prior equal-length window. */
  wowDelta: number;
}

export interface CacheResponse {
  readRate: number;
  creationTokens: number;
  readTokens: number;
  inputTokens: number;
  outputTokens: number;
  totalCost: number;
  dollarsSaved: number;
  wowDelta: number;
}

export interface CompareResponse {
  projects: Array<{
    path: string;
    name: string;
    sessions: number;
    cost: number;
    avgCost: number;
    prompts: number;
    cacheHit: number;
    /** Per-model cost split for the stacked bars. */
    byModel: Array<{ model: string; cost: number }>;
    /** Top tools by call count (up to 4). */
    topTools: string[];
  }>;
}

/** One dashboard stat tile: current value, fractional WoW delta, 7-point sparkline. */
export interface StatMetric {
  value: number;
  delta: number;
  series: number[];
}

export interface StatsResponse {
  lastSessionCost: StatMetric;
  toolCalls: StatMetric;
  subagentPct: StatMetric;
  drift: StatMetric;
}

export interface GraphHealthResponse {
  /** Spec-link counts keyed by state (verified/drifted/broken/orphaned/…). */
  linkHealth: Record<string, number>;
  /** Edge counts bucketed into calls / implements / tests / synth. */
  edgeKinds: Record<string, number>;
  /** Most-connected nodes by total degree. */
  hubs: Array<{ id: string; name: string; kind: string; filePath: string; degree: number }>;
}

export interface TipEvidence {
  session: string;
  detail: string;
}

export interface Tip {
  id: string;
  severity: 'error' | 'warn' | 'info';
  icon?: string;
  title: string;
  why: string;
  evidence: TipEvidence;
  fix: string;
  saving: string;
}

export interface TipsResponse {
  tips: Tip[];
}

export interface SpecLink {
  id: number;
  specId: string;
  specTitle: string | null;
  targetFilePath: string;
  targetQualifiedName: string;
  targetNodeKind: string;
  resolvedNodeId: string | null;
  kind: string;
  state: 'drafted' | 'implementing' | 'implemented' | 'verified' | 'drifted' | 'broken' | 'orphaned';
  driftAxis: 'spec' | 'code' | null;
  provenance: string;
  confidence: number;
  createdAt: number;
  updatedAt: number;
}

export interface DriftResponse {
  links: SpecLink[];
}

export interface Spec {
  id: string;
  kind: 'document' | 'requirement' | 'acceptance' | 'contract' | 'data_schema' | 'brief';
  title: string;
  body: string;
  format: string;
  sourcePath: string;
  parentId: string | null;
  contentHash: string;
  owner: string | null;
  priority: string | null;
}

export interface SpecsResponse {
  specs: Spec[];
}

/** Spec lifecycle funnel: idea → spec → implemented (GET /api/spec/funnel). */
export interface SpecFunnel {
  summary: {
    ideas: number;
    specified: number;
    conflicts: number;
    documents: number;
    requirements: number;
    links: { implemented: number; verified: number; drifted: number; broken: number; orphaned: number };
  };
  documents: Array<{
    id: string;
    title: string;
    rollup: { requirements: number; implemented: number; verified: number; drifted: number; broken: number; orphaned: number };
  }>;
  ideas: Array<{ briefId: string; title: string }>;
  conflicts: Array<{ briefId: string; briefSide: string | null; specSide: string | null }>;
}

export interface SpecDetailResponse {
  spec: Spec;
  parent: Spec | null;
  siblings: Spec[];
  children: Spec[];
  links: SpecLink[];
}

export interface SpecBriefResponse {
  path: string;
  markdown: string;
}

export interface WorkflowDef {
  name: string;
  description?: string;
  tags?: string[];
  requires?: string[];
  inputs?: Array<{ name: string; required?: boolean; default?: string; description?: string }>;
  nodes: Array<{ id: string; kind: string }>;
}

export interface WorkflowEntry {
  workflow: WorkflowDef;
  scope: 'bundled' | 'global' | 'project';
  sourcePath: string;
}

export interface WorkflowsResponse {
  workflows: WorkflowEntry[];
  errors: Array<{ scope: string; sourcePath: string; errors: Array<{ path: string; message: string }> }>;
}

export interface WorkflowRun {
  id: string;
  workflowName: string;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  startedAt: number | null;
  completedAt: number | null;
  lastActivityAt: number;
  createdAt: number;
  errorMessage: string | null;
  metadata: Record<string, unknown>;
  isolationEnvId?: string;
}

export interface RunsResponse {
  runs: WorkflowRun[];
}

export interface WorkflowEvent {
  id: number;
  eventType: string;
  stepId: string | null;
  stepKind?: string;
  data: Record<string, unknown>;
  createdAt: number;
}

export interface RunDetailResponse {
  run: WorkflowRun;
  events: WorkflowEvent[];
}

// Graph (code) ---------------------------------------------------------------

export interface GraphNode {
  id: string;
  name: string;
  kind: string;
  filePath: string;
  startLine: number;
  endLine: number;
  signature?: string;
  docstring?: string;
}

export interface GraphSearchResult {
  node: GraphNode;
  score?: number;
}

export interface GraphSearchResponse {
  results: GraphSearchResult[];
}

export interface GraphNodeDetail extends GraphNode {
  callers: GraphNode[];
  callees: GraphNode[];
  linkedSpecs: SpecLink[];
}

export interface GraphNodeResponse {
  matches: GraphNodeDetail[];
}

// ----- Memory (CLAUDE.md hierarchy + ~/.claude/memory notes) -----

export type MemoryLevelKey = 'enterprise' | 'user' | 'project' | 'subdir' | 'import' | 'note';
export type MemoryTypeKey = 'instruction' | 'note' | 'import';

export interface MemoryFile {
  id: string;
  level: MemoryLevelKey;
  type: MemoryTypeKey;
  name: string;
  scope: string;
  path: string;
  tokens: number;
  lines: number;
  modified: string;
  body: string;
  readOnly?: boolean;
  imports?: string[];
  session?: string;
  tags?: string[];
}

export interface MemoryResponse {
  totalTokens: number;
  instructionCount: number;
  noteCount: number;
  importCount: number;
  files: MemoryFile[];
}

// ----- Projects (live-discovered from ~/.claude/projects/) -----

export interface ProjectEntry {
  slug: string;
  path: string;
  exists: boolean;
  initialized: boolean;
  sessionCount: number;
  lastModifiedMs: number;
}

export interface ProjectsResponse {
  claudeRoot: string;
  projects: ProjectEntry[];
}

export interface ProjectsChange {
  added: ProjectEntry[];
  removed: string[];
  list: ProjectEntry[];
}

export interface ProjectsRefresh {
  list: ProjectEntry[];
}

export interface SpecshipImpactResponse {
  spendTokens: number;
  spendCostUsd: number;
  savedTokens: number;
  savedCostUsd: number;
  overheadTokens: number;
  netTokens: number;
  netCostUsd: number;
  unresolvedCalls: number;
  totalSpecshipCalls: number;
  byTool: { tool: string; calls: number; spendTokens: number; savedTokens: number }[];
  /** Only present when no project filter is active (all-projects mode). */
  byProject: { project: string; spendTokens: number; savedTokens: number; netTokens: number }[];
  trend: { ts: number; spendTokens: number; savedTokens: number }[];
}

// --- Reflection engine (REFLECT-DOC) ---

export type ReflectProposalType = 'memory_rule' | 'skill' | 'hook';
export type ReflectSeverity = 'high' | 'warn' | 'info';
export type ReflectState = 'open' | 'applied' | 'undone' | 'dismissed';
export type ReflectTargetKind = 'claude_md' | 'memory_note' | 'command' | 'settings_hook';

export interface ReflectEvidence {
  sessions: string[];
  prompts: string[];
  detail: string;
}

export interface ReflectProposal {
  contentHash: string;
  type: ReflectProposalType;
  severity: ReflectSeverity;
  title: string;
  body: string;
  targetKind: ReflectTargetKind;
  targetPath: string;
  evidence: ReflectEvidence;
  state: ReflectState;
  createdAt: number;
  updatedAt: number;
  appliedAt: number | null;
}

export interface ReflectListResponse {
  proposals: ReflectProposal[];
}

export interface ReflectAnalyzeResponse {
  open: ReflectProposal[];
  empty: boolean;
}

export interface ReflectPreview {
  targetPath: string;
  targetKind: ReflectTargetKind;
  exists: boolean;
  before: string;
  after: string;
  diff: string;
  conflict?: boolean;
}

export interface ReflectActionResponse {
  outcome?: 'applied' | 'unchanged' | 'conflict' | 'undone' | 'noop';
  ok?: boolean;
  proposal: ReflectProposal;
}

// --- Maintainability harness (MAINT-DOC / REQ-MAINT-003) ---

export interface MaintCoupling {
  nodeId: string; name: string; qualifiedName: string; filePath: string; kind: string;
  fanIn: number; fanOut: number; reason: string;
}
export interface MaintOversized {
  nodeId: string; name: string; qualifiedName: string; filePath: string; kind: string;
  startLine: number; endLine: number; lines: number; reason: string;
}
export interface MaintGodFile { filePath: string; symbolCount: number; reason: string; }
export interface MaintCycle { files: string[]; reason: string; }
export interface MaintDeadCode {
  nodeId: string; name: string; qualifiedName: string; filePath: string; kind: string;
  startLine: number; reason: string;
}
export interface MaintainabilityReport {
  thresholds: { highDegree: number; largeSymbolLines: number; godFileSymbols: number };
  coupling: MaintCoupling[];
  oversized: MaintOversized[];
  godFiles: MaintGodFile[];
  cycles: MaintCycle[];
  deadCode: MaintDeadCode[];
  clean: boolean;
}
