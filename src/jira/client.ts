/**
 * Minimal JIRA REST client (REQ-JIRA-001, A3).
 *
 * Wraps `fetch` with the base URL + auth header. `testConnection()` probes
 * `/rest/api/2/myself` (available on both Cloud and Data Center);
 * `listMyIssues()` (REQ-JIRA-002) searches the current user's issues. Both
 * go through the private `request()` helper so the security guards below
 * apply to every credentialed call.
 *
 * SECURITY (foundation for REQ-JIRA-009):
 *  - `redirect: 'manual'` — we never auto-follow a redirect, so the
 *    `Authorization` header can't be replayed to a different host.
 *  - We only ever talk to the configured base URL's host; a cross-host
 *    (or any) redirect is refused, not followed.
 *  - No thrown error or result field ever contains the credential.
 */

import { buildAuthHeader } from './auth';
import {
  JiraCredentials,
  JiraConnectionResult,
  JiraIssue,
  JiraIssueListResult,
  JiraConfigError,
  JiraAuthError,
} from './types';

/** Upper bound on issues fetched in one list call — never unbounded. */
const MAX_ISSUE_RESULTS = 50;

export class JiraClient {
  private readonly baseUrl: string;
  private readonly host: string;
  private readonly authHeader: string;

  constructor(creds: JiraCredentials) {
    // Normalize: strip trailing slashes so path joins are clean.
    this.baseUrl = creds.baseUrl.replace(/\/+$/, '');
    try {
      this.host = new URL(this.baseUrl).host;
    } catch {
      throw new JiraConfigError(
        `Invalid JIRA base URL: ${creds.baseUrl}`,
      );
    }
    this.authHeader = buildAuthHeader(creds);
  }

  /**
   * Probe the instance's `/myself` endpoint.
   *  - 200 → `{ ok: true, accountId, displayName }`.
   *  - 401 / 403 → `JiraAuthError`.
   *  - 3xx redirect → `JiraConfigError` (refused, never followed).
   *  - network / DNS failure → `JiraConfigError`.
   */
  async testConnection(): Promise<JiraConnectionResult> {
    const body = await this.request('/rest/api/2/myself');
    return {
      ok: true,
      // Cloud → accountId; Data Center → key/name. Prefer the most stable.
      accountId: body?.accountId ?? body?.key ?? body?.name,
      displayName: body?.displayName ?? body?.name,
    };
  }

  /**
   * List the issues assigned to the authenticated user (REQ-JIRA-002).
   * Identity comes from the token via JQL `currentUser()` — the user never
   * types their own name (A1). An optional `project` narrows the search
   * (A2); the value is quote-escaped to prevent JQL injection. Ordered
   * most-actionable-first (recently updated). Bounded by `MAX_ISSUE_RESULTS`.
   *
   *  - 200 → `{ ok: true, issues }`; an empty list is a valid success (A3).
   *  - 401 / 403 → `JiraAuthError`; redirect / network / non-200 →
   *    `JiraConfigError` (A4) — never a partial or fabricated list.
   */
  async listMyIssues(opts?: { project?: string }): Promise<JiraIssueListResult> {
    let jql = 'assignee = currentUser()';
    if (opts?.project && opts.project.trim()) {
      // Quote-escape the project so an embedded quote can't break out of the
      // JQL string literal (injection guard). JQL escapes `"` as `\"`.
      const escaped = opts.project.trim().replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      jql = `project = "${escaped}" AND ${jql}`;
    }
    jql += ' ORDER BY updated DESC';

    const params = new URLSearchParams({
      jql,
      fields: 'summary,status,issuetype',
      maxResults: String(MAX_ISSUE_RESULTS),
    });
    const body = await this.request(`/rest/api/2/search?${params.toString()}`);

    const rawIssues: any[] = Array.isArray(body?.issues) ? body.issues : [];
    const issues: JiraIssue[] = rawIssues.map(issue => ({
      key: String(issue?.key ?? ''),
      id: String(issue?.id ?? ''),
      summary: String(issue?.fields?.summary ?? ''),
      status: String(issue?.fields?.status?.name ?? ''),
      issueType: String(issue?.fields?.issuetype?.name ?? ''),
    }));

    return { ok: true, issues };
  }

  /**
   * Shared, credentialed GET against the configured host. Every security
   * guard lives here so no call path can skip one:
   *  - `redirect: 'manual'` — the `Authorization` header is never replayed
   *    across a redirect; any 3xx / opaqueredirect is refused, not followed.
   *  - 401 / 403 → `JiraAuthError`; network / non-200 / non-JSON →
   *    `JiraConfigError`.
   *  - No thrown message ever contains the credential — only the host.
   *
   * Returns the parsed JSON body on success.
   */
  private async request(path: string): Promise<any> {
    const url = `${this.baseUrl}${path}`;

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'GET',
        redirect: 'manual',
        headers: {
          Authorization: this.authHeader,
          Accept: 'application/json',
        },
      });
    } catch (err) {
      // Network / DNS — the message is fetch's own (no credential in it),
      // but we prepend the host, never the header.
      const msg = err instanceof Error ? err.message : String(err);
      throw new JiraConfigError(
        `Could not reach JIRA at ${this.host}: ${msg}`,
      );
    }

    // Refuse any redirect — do not follow it to another host.
    if (
      res.type === 'opaqueredirect' ||
      (res.status >= 300 && res.status < 400)
    ) {
      throw new JiraConfigError(
        `JIRA at ${this.host} returned an unexpected redirect; refusing to ` +
          `follow it to another host.`,
      );
    }

    if (res.status === 401 || res.status === 403) {
      throw new JiraAuthError(
        `JIRA rejected the credentials (HTTP ${res.status}). ` +
          `Check the email/token or PAT.`,
      );
    }

    if (!res.ok) {
      throw new JiraConfigError(
        `JIRA at ${this.host} returned HTTP ${res.status}.`,
      );
    }

    try {
      return await res.json();
    } catch {
      throw new JiraConfigError(
        `JIRA at ${this.host} returned a non-JSON response.`,
      );
    }
  }
}
