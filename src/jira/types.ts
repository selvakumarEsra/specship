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
 * A single JIRA issue as surfaced by the list path (REQ-JIRA-002). Carries
 * only the four fields the requirement names — key/id, summary, status, and
 * issue type — never any credential-adjacent data.
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
