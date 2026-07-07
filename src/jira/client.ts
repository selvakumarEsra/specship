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
  JiraIssueResult,
  JiraTransition,
  JiraTransitionResult,
  JiraConfigError,
  JiraAuthError,
  JiraNotFoundError,
} from './types';

/** Upper bound on issues fetched in one list call — never unbounded. */
const MAX_ISSUE_RESULTS = 50;

export class JiraClient {
  private readonly baseUrl: string;
  private readonly host: string;
  private readonly authHeader: string;
  private readonly deployment: JiraCredentials['deployment'];

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
    this.deployment = creds.deployment;
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
    // JIRA Cloud removed the classic `GET /rest/api/2/search` in 2025 — it now
    // returns HTTP 410 Gone — in favour of the enhanced-search endpoint
    // `/search/jql`. Data Center never removed the classic endpoint (and older
    // versions don't have `/search/jql`), so it keeps using `/search`. The
    // response shape we consume (`body.issues[].fields.*`) is identical on both,
    // and `/search/jql` requires `fields` to be listed explicitly — which we
    // already do above. (REQ-JIRA-002.A5)
    const searchPath =
      this.deployment === 'datacenter'
        ? `/rest/api/2/search?${params.toString()}`
        : `/rest/api/2/search/jql?${params.toString()}`;
    const body = await this.request(searchPath);

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
   * Fetch a single issue by its key (REQ-JIRA-003). Identity/authorization
   * ride the token — a key the user can't see is indistinguishable from a
   * missing one and both surface as `JiraNotFoundError` (A2). The key is
   * URL-encoded before it enters the path so a slash/space can't traverse or
   * inject into the request line.
   *
   *  - 200 → `{ ok: true, issue }` with summary/description/status/type/subtasks.
   *  - 404 → `JiraNotFoundError` (no such issue, or no access).
   *  - 401 / 403 → `JiraAuthError`; redirect / network / non-200 →
   *    `JiraConfigError`. Never a partial or fabricated issue.
   */
  async getIssue(key: string): Promise<JiraIssueResult> {
    const trimmed = (key ?? '').trim();
    if (!trimmed) {
      throw new JiraConfigError('An issue key is required (e.g., "PROJ-123").');
    }

    // URL-encode the key: a slash or space in the key must not traverse the
    // path or split the request — encode it into a single path segment.
    const params = new URLSearchParams({
      fields: 'summary,description,status,issuetype,subtasks',
    });
    const body = await this.request(
      `/rest/api/2/issue/${encodeURIComponent(trimmed)}?${params.toString()}`,
    );

    const fields = body?.fields ?? {};
    // api/2 returns `description` as a plain string. Guard the non-string case
    // (null → no body; an ADF object under a future api/3 → not `[object
    // Object]`) by treating anything non-string as empty.
    const description =
      typeof fields.description === 'string' ? fields.description : '';
    const rawSubtasks: any[] = Array.isArray(fields.subtasks)
      ? fields.subtasks
      : [];
    const subtasks = rawSubtasks.map(st => ({
      key: String(st?.key ?? ''),
      summary: String(st?.fields?.summary ?? ''),
      status: String(st?.fields?.status?.name ?? ''),
    }));

    const issue: JiraIssue = {
      key: String(body?.key ?? trimmed),
      id: String(body?.id ?? ''),
      summary: String(fields.summary ?? ''),
      status: String(fields.status?.name ?? ''),
      issueType: String(fields.issuetype?.name ?? ''),
      description,
      subtasks,
    };

    return { ok: true, issue };
  }

  /**
   * List the transitions the issue's current workflow state offers
   * (REQ-JIRA-007). `GET /issue/{key}/transitions`. Used to resolve a
   * configured transition name/id to an executable id before writing.
   */
  async listTransitions(key: string): Promise<JiraTransition[]> {
    const trimmed = (key ?? '').trim();
    if (!trimmed) {
      throw new JiraConfigError('An issue key is required (e.g., "PROJ-123").');
    }
    const body = await this.request(
      `/rest/api/2/issue/${encodeURIComponent(trimmed)}/transitions`,
    );
    const raw: any[] = Array.isArray(body?.transitions) ? body.transitions : [];
    return raw.map(t => ({ id: String(t?.id ?? ''), name: String(t?.name ?? '') }));
  }

  /**
   * Drive the issue toward a target state (REQ-JIRA-007). `nameOrId` is
   * matched against the issue's available transitions by exact id first, then
   * case-insensitively by name. On a match it POSTs `/transitions`. When NO
   * transition matches — because this project's workflow doesn't offer it —
   * it returns `{ ok, skipped, reason }` and NEVER throws (A3): a missing
   * transition is an expected, recoverable state, and the caller still
   * comments the PR link and reports the skip. Auth/network faults on the
   * write still throw like any other credentialed call.
   */
  async transitionIssue(
    key: string,
    nameOrId: string,
  ): Promise<JiraTransitionResult> {
    const trimmed = (key ?? '').trim();
    if (!trimmed) {
      throw new JiraConfigError('An issue key is required (e.g., "PROJ-123").');
    }
    const target = (nameOrId ?? '').trim();
    if (!target) {
      return {
        ok: true,
        skipped: nameOrId,
        reason: 'no transition name/id was configured',
      };
    }

    const available = await this.listTransitions(trimmed);
    const wanted = target.toLowerCase();
    const match = available.find(
      t => t.id === target || t.name.toLowerCase() === wanted,
    );
    if (!match) {
      const names = available.map(t => t.name).join(', ') || 'none';
      return {
        ok: true,
        skipped: target,
        reason: `no "${target}" transition on this issue's workflow (available: ${names})`,
      };
    }

    await this.write(
      `/rest/api/2/issue/${encodeURIComponent(trimmed)}/transitions`,
      { transition: { id: match.id } },
    );
    return { ok: true, transitioned: match.name };
  }

  /**
   * Assign the issue (REQ-JIRA-007). Cloud keys assignment by `accountId`;
   * Data Center by `name`. `PUT /issue/{key}/assignee`. A 204 (no body) is the
   * success shape — the `write` helper tolerates an empty response.
   */
  async assignIssue(key: string, accountId: string): Promise<void> {
    const trimmed = (key ?? '').trim();
    if (!trimmed) {
      throw new JiraConfigError('An issue key is required (e.g., "PROJ-123").');
    }
    const body =
      this.deployment === 'datacenter'
        ? { name: accountId }
        : { accountId };
    await this.write(
      `/rest/api/2/issue/${encodeURIComponent(trimmed)}/assignee`,
      body,
      'PUT',
    );
  }

  /**
   * Add a comment to the issue (REQ-JIRA-007) — used to record the PR link.
   * `POST /issue/{key}/comment`. api/2 takes a plain-string body.
   *
   * SECURITY: the caller only ever passes the public PR URL / issue key here,
   * never a credential (REQ-JIRA-009).
   */
  async addComment(key: string, body: string): Promise<void> {
    const trimmed = (key ?? '').trim();
    if (!trimmed) {
      throw new JiraConfigError('An issue key is required (e.g., "PROJ-123").');
    }
    await this.write(
      `/rest/api/2/issue/${encodeURIComponent(trimmed)}/comment`,
      { body },
    );
  }

  /**
   * Shared, credentialed GET against the configured host. Delegates to
   * `send()` for the security guards, then parses JSON. Returns the parsed
   * JSON body on success; a non-JSON body is a `JiraConfigError`.
   */
  private async request(path: string): Promise<any> {
    const res = await this.send(path, 'GET');
    try {
      return await res.json();
    } catch {
      throw new JiraConfigError(
        `JIRA at ${this.host} returned a non-JSON response.`,
      );
    }
  }

  /**
   * Shared, credentialed write (POST/PUT) against the configured host
   * (REQ-JIRA-007). Carries EVERY guard `request()` does via `send()` —
   * `redirect: 'manual'`, host-lock, 401/403 → auth, 404 → not-found,
   * non-2xx → config, credential-free messages. A JSON body is sent with
   * `Content-Type: application/json`; a success with no/empty body (204, the
   * common transition/assignee shape) resolves to `null` rather than erroring
   * on the missing JSON.
   */
  private async write(
    path: string,
    body: unknown,
    method: 'POST' | 'PUT' = 'POST',
  ): Promise<any> {
    const res = await this.send(path, method, JSON.stringify(body ?? {}));
    // 204 No Content (assignee/transition) has no body — don't force JSON.
    if (res.status === 204) return null;
    try {
      return await res.json();
    } catch {
      // A 2xx write with an empty/non-JSON body is still a success.
      return null;
    }
  }

  /**
   * The single fetch + guard chokepoint shared by `request` and `write`. Every
   * security guard lives here so no call path can skip one:
   *  - `redirect: 'manual'` — the `Authorization` header is never replayed
   *    across a redirect; any 3xx / opaqueredirect is refused, not followed.
   *  - only ever talks to the configured host.
   *  - 401 / 403 → `JiraAuthError`; 404 → `JiraNotFoundError`; network /
   *    non-2xx → `JiraConfigError`.
   *  - No thrown message ever contains the credential — only the host.
   *
   * Returns the raw `Response` on a 2xx; the caller parses the body.
   */
  private async send(
    path: string,
    method: 'GET' | 'POST' | 'PUT',
    jsonBody?: string,
  ): Promise<Response> {
    const url = `${this.baseUrl}${path}`;

    const headers: Record<string, string> = {
      Authorization: this.authHeader,
      Accept: 'application/json',
    };
    if (jsonBody !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    let res: Response;
    try {
      res = await fetch(url, {
        method,
        redirect: 'manual',
        headers,
        ...(jsonBody !== undefined ? { body: jsonBody } : {}),
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

    // A missing issue — or one the token can't see — is a distinct, expected
    // signal (REQ-JIRA-003 A2). Must precede the generic !res.ok branch below,
    // and stays credential-free like every other message here.
    if (res.status === 404) {
      throw new JiraNotFoundError(
        `JIRA at ${this.host} has no such issue, or you don't have access ` +
          `to it (HTTP 404).`,
      );
    }

    if (!res.ok) {
      throw new JiraConfigError(
        `JIRA at ${this.host} returned HTTP ${res.status}.`,
      );
    }

    return res;
  }
}
