/**
 * Same-origin fetch wrappers over the dashboard server's /api routes
 * (packages/server/src/routes/*). The SPA is served by that same server —
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
const postJson = <T,>(path: string) => request<T>(path, { method: 'POST' });

/** Append `?project=<slug>` when a non-primary project is selected. */
function q(path: string, project?: string | null): string {
  if (!project) return path;
  return path + (path.includes('?') ? '&' : '?') + 'project=' + encodeURIComponent(project);
}

// ---- Response shapes (mirroring packages/server/src/routes/*) ----

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

export interface SpecDoc {
  id: string;
  title: string;
  filePath?: string;
  state?: string;
  priority?: string;
  kind?: string;
  [key: string]: unknown;
}

export interface SpecsResponse {
  specs: SpecDoc[];
  linkStates: Record<string, string>;
}

export interface DriftLink {
  specId: string;
  state: string;
  specTitle: string | null;
  targetFile?: string;
  targetSymbol?: string;
  [key: string]: unknown;
}

export interface DriftResponse {
  links: DriftLink[];
}

export interface WorkflowRun {
  id: string;
  workflowId?: string;
  status: string;
  startedAt?: string | number | null;
  finishedAt?: string | number | null;
  eta?: unknown;
  [key: string]: unknown;
}

export interface RunsResponse {
  runs: WorkflowRun[];
}

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

// ---- API surface ----

export const api = {
  status: (project?: string | null) => getJson<StatusResponse>(q('/api/status', project)),
  refresh: (project?: string | null) => postJson<StatusResponse>(q('/api/refresh', project)),
  graphFull: (project?: string | null, limit = 250) =>
    getJson<GraphFullResponse>(q(`/api/graph/full?limit=${limit}`, project)),
  specs: (project?: string | null) => getJson<SpecsResponse>(q('/api/specs', project)),
  drift: (project?: string | null) => getJson<DriftResponse>(q('/api/drift', project)),
  runs: (project?: string | null) => getJson<RunsResponse>(q('/api/workflows/runs', project)),
  projects: () => getJson<ProjectsResponse>('/api/projects'),
};
