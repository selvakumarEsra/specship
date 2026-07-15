/**
 * JIRA connection types (REQ-JIRA-001).
 *
 * SpecShip talks to both JIRA deployments:
 *  - **Cloud** — authenticated with HTTP Basic (`email:apiToken`).
 *  - **Data Center / Server** — authenticated with a `Bearer` PAT.
 *
 * SECURITY: no field here should ever be echoed to logs, CLI output, or
 * thrown-error messages. The token/PAT is a secret — surface only the
 * base URL host and the resolved display name (REQ-JIRA-009 builds on this).
 */

/** Which JIRA deployment we're talking to. */
export type JiraDeployment = 'cloud' | 'datacenter';

/**
 * Names (or ids) of the workflow transitions SpecShip drives at lifecycle
 * moments (REQ-JIRA-007). JIRA workflows differ per project, so these are
 * configurable; each is matched case-insensitively against the transitions
 * the issue actually offers, and an unconfigured project keeps the sensible
 * defaults ("In Progress" on start, "In Review" on PR raised).
 */
export interface JiraTransitionNames {
  /** Transition applied on start (default "In Progress"). */
  inProgress?: string;
  /** Transition applied when a PR is raised (default "In Review"). */
  inReview?: string;
  /**
   * Transition applied when acceptance evidence verifies (REQ-JIRAPUB-005),
   * driving a published Sub-task (and, once all Sub-tasks are done, its
   * Story) toward completion. Default "Done".
   */
  done?: string;
}

/**
 * Fully-resolved credentials used to build a request against a JIRA
 * instance. `deployment` is always resolved (inferred if not explicit).
 */
export interface JiraCredentials {
  /** Base URL of the JIRA instance, e.g. `https://acme.atlassian.net`. */
  baseUrl: string;
  /** Resolved deployment kind. */
  deployment: JiraDeployment;
  /** Cloud only: the account email used with an API token. */
  email?: string;
  /** Cloud only: the API token paired with `email`. */
  apiToken?: string;
  /** Data Center only: the personal access token. */
  pat?: string;
  /**
   * Resolved lifecycle transition names (REQ-JIRA-007).
   * `resolveJiraCredentials` always fills the defaults; optional here so
   * hand-built credentials (tests, direct callers) needn't supply it.
   */
  transitions?: JiraTransitionNames;
  /** Default project key for spec→JIRA publishing (REQ-JIRAPUB-001). */
  project?: string;
  /**
   * Path to a PEM CA bundle trusted for JIRA requests (REQ-JIRATLS-001) —
   * the preferred fix for Data Center behind a corporate/self-signed cert.
   */
  caCertPath?: string;
  /**
   * Disable TLS certificate verification for JIRA requests ONLY
   * (REQ-JIRATLS-001). Explicit opt-in, never inferred, never
   * process-global. Last resort when no CA bundle is available.
   */
  insecureTls?: boolean;
}

/**
 * On-disk config shape (`~/.specship/jira.json`). `deployment` is
 * optional on disk — it's inferred from which credentials are present
 * when not stored explicitly.
 */
export interface JiraConfig {
  baseUrl: string;
  deployment?: JiraDeployment;
  email?: string;
  apiToken?: string;
  pat?: string;
  /**
   * Optional per-project transition names (REQ-JIRA-007). Omitted → the
   * built-in "In Progress" / "In Review" defaults apply.
   */
  transitions?: JiraTransitionNames;
  /** PEM CA bundle for corporate/self-signed TLS (REQ-JIRATLS-001). */
  caCertPath?: string;
  /** Disable TLS verification for JIRA requests only (REQ-JIRATLS-001). */
  insecureTls?: boolean;
  /**
   * Default project key that spec→JIRA publishing creates issues in
   * (REQ-JIRAPUB-001). A publish call may override it per invocation.
   */
  project?: string;
}

/**
 * Result of probing a JIRA instance's `/myself` endpoint. Carries only
 * non-secret identity fields — never the credential.
 */
export interface JiraConnectionResult {
  ok: boolean;
  accountId?: string;
  displayName?: string;
  error?: string;
}

/**
 * A single JIRA issue. The list path (REQ-JIRA-002) populates only the four
 * always-present fields — key/id, summary, status, and issue type. The detail
 * path (REQ-JIRA-003) additionally fills `description` and `subtasks`; both are
 * optional so the list path is unaffected. Never any credential-adjacent data.
 */
export interface JiraIssue {
  /** Human-facing key, e.g. `PROJ-123`. */
  key: string;
  /** Numeric/opaque internal id. */
  id: string;
  /** One-line summary of the issue. */
  summary: string;
  /** Current workflow status name, e.g. `In Progress`. */
  status: string;
  /** Issue type name, e.g. `Bug`, `Story`. */
  issueType: string;
  /** Detail path only (REQ-JIRA-003): the issue body, empty string if none. */
  description?: string;
  /** Detail path only (REQ-JIRA-003): child subtasks, if any. */
  subtasks?: Array<{ key: string; summary: string; status: string }>;
}

/**
 * Result of listing the current user's issues (REQ-JIRA-002). An empty
 * `issues` array is a valid success (A3) — a user with nothing assigned is
 * not an error. Any auth/network/non-200 failure throws instead of returning
 * a partial or fabricated list (A4).
 */
export interface JiraIssueListResult {
  ok: true;
  issues: JiraIssue[];
}

/**
 * Result of fetching a single issue by key (REQ-JIRA-003). The single-issue
 * analog of `JiraIssueListResult`. A missing / no-access issue throws
 * `JiraNotFoundError` rather than returning an empty result (A2).
 */
export interface JiraIssueResult {
  ok: true;
  issue: JiraIssue;
}

/**
 * A single transition offered by an issue's current workflow state
 * (REQ-JIRA-007). Returned by `GET /issue/{key}/transitions`.
 */
export interface JiraTransition {
  /** The transition id used to execute it (`POST /transitions`). */
  id: string;
  /** The transition's human-facing name, e.g. "In Progress". */
  name: string;
}

/**
 * Outcome of attempting a lifecycle transition (REQ-JIRA-007). Never a thrown
 * error for a *missing* transition — a workflow that lacks the configured
 * transition returns `{ ok, skipped, reason }` so the flow can still comment
 * the PR link and report the skip (A3). A genuine auth/network fault on the
 * write still throws, like every other credentialed call.
 */
export type JiraTransitionResult =
  | { ok: true; transitioned: string }
  | { ok: true; skipped: string; reason: string };

/**
 * Base class for JIRA errors. Mirrors `McpConfigError` in
 * `server/src/routes/mcp.ts` — a plain `Error` subclass with a code.
 *
 * SECURITY: never construct one of these with a message that contains a
 * token, PAT, or the `Authorization` header value.
 */
export class JiraError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'JiraError';
    this.code = code;
  }
}

/** Missing / malformed configuration, or an unreachable host. */
export class JiraConfigError extends JiraError {
  constructor(message: string) {
    super(message, 'JIRA_CONFIG_ERROR');
    this.name = 'JiraConfigError';
  }
}

/** The instance rejected the credentials (HTTP 401 / 403). */
export class JiraAuthError extends JiraError {
  constructor(message: string) {
    super(message, 'JIRA_AUTH_ERROR');
    this.name = 'JiraAuthError';
  }
}

/**
 * The requested issue does not exist or the user can't see it (HTTP 404)
 * — REQ-JIRA-003 A2. Distinct from config/auth errors so the caller can
 * surface a clear "no such issue / no access" message and do no downstream
 * work, rather than silently returning an empty spec.
 */
export class JiraNotFoundError extends JiraError {
  constructor(message: string) {
    super(message, 'JIRA_NOT_FOUND');
    this.name = 'JiraNotFoundError';
  }
}
