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
}

export interface ClaudeToolCall {
  id: number;
  prompt_id: string;
  session_id: string;
  assistant_uuid: string;
  tool_use_id: string | null;
  tool_name: string;
  input_summary: string | null;
  result_length: number;
  ts: number;
}

export interface SessionsResponse {
  sessions: ClaudeSession[];
}

export interface SessionDetailResponse {
  session: ClaudeSession;
  prompts: ClaudePrompt[];
  toolCalls: ClaudeToolCall[];
}

export interface HeatmapResponse {
  files: Array<{ path: string; calls: number; resultBytes: number }>;
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
  }>;
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
  kind: 'document' | 'requirement' | 'acceptance' | 'contract' | 'data_schema';
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

export interface SpecDetailResponse {
  spec: Spec;
  parent: Spec | null;
  siblings: Spec[];
  children: Spec[];
  links: SpecLink[];
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
