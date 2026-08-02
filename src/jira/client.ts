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

import * as fs from 'fs';
import * as https from 'https';
import { buildAuthHeader } from './auth';
import { wrapRepoBindingProjectError } from './repo-config';
import {
  JiraCredentials,
  JiraConnectionResult,
  JiraEpic,
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
export const MAX_ISSUE_RESULTS = 50;

/**
 * The structural subset of `Response` the client consumes. Both transports
 * — global `fetch` and the TLS-aware `https` path (REQ-JIRATLS-001) —
 * produce this, so every guard in `send()` applies identically to each.
 */
interface JiraHttpResponse {
  status: number;
  ok: boolean;
  type: string;
  json(): Promise<any>;
}

export class JiraClient {
  private readonly baseUrl: string;
  private readonly host: string;
  private readonly authHeader: string;
  private readonly deployment: JiraCredentials['deployment'];
  /**
   * Non-null when a TLS opt-in is active (REQ-JIRATLS-001): a custom CA
   * bundle and/or verification disabled — scoped to JIRA requests only,
   * never process-global.
   */
  private readonly tls: { ca?: Buffer; rejectUnauthorized: boolean } | null;
  /** Repo-binding provenance (REQ-JIRATEAM-001), used to enrich A4 errors. */
  private readonly bindingSource?: 'repo' | 'user';
  private readonly bindingPath?: string;

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
    this.bindingSource = creds.bindingSource;
    this.bindingPath = creds.bindingPath;

    if (creds.caCertPath || creds.insecureTls) {
      let ca: Buffer | undefined;
      if (creds.caCertPath) {
        try {
          ca = fs.readFileSync(creds.caCertPath);
        } catch {
          // Fail fast (REQ-JIRATLS-001.A4) — only the path, no credential.
          throw new JiraConfigError(
            `Could not read the JIRA CA certificate at ${creds.caCertPath}.`,
          );
        }
      }
      this.tls = { ca, rejectUnauthorized: !creds.insecureTls };
    } else {
      this.tls = null;
    }
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
  async listMyIssues(opts?: { project?: string; sprint?: 'active' }): Promise<JiraIssueListResult> {
    let jql = 'assignee = currentUser()';
    if (opts?.project && opts.project.trim()) {
      // Quote-escape the project so an embedded quote can't break out of the
      // JQL string literal (injection guard). JQL escapes `"` as `\"`.
      const escaped = opts.project.trim().replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      jql = `project = "${escaped}" AND ${jql}`;
    }
    // Sprint filter (TASKSHIP-BRIDGE-DOC, REQ-TASKSHIP-001): scope to the
    // active sprint so a developer pulls "my tasks for today" rather than
    // every issue ever assigned. `openSprints()` is a JQL function (no user
    // input), so there is nothing to escape.
    if (opts?.sprint === 'active') {
      jql = `${jql} AND sprint in openSprints()`;
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
   * List issues in a project's active (or named) sprint (REQ-JIRATEAM-004).
   * Read-only — no transitions, no edits. `project` is required; `sprint` is
   * optional (omitted → `sprint in openSprints()`, the currently-open sprints
   * of the board bound to the project). Both values are quote-escaped to
   * prevent JQL injection. Bounded by `MAX_ISSUE_RESULTS`.
   *
   *  - 200 → `{ ok: true, issues }`; an empty list is a valid success.
   *  - 401 / 403 → `JiraAuthError`; redirect / network / non-200 →
   *    `JiraConfigError`.
   */
  async listSprintIssues(opts: { project: string; sprint?: string }): Promise<JiraIssueListResult> {
    const project = (opts.project ?? '').trim();
    if (!project) {
      throw new JiraConfigError('A JIRA project key is required to list sprint issues.');
    }
    const escProject = project.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    let jql = `project = "${escProject}"`;
    if (opts.sprint && opts.sprint.trim()) {
      const escSprint = opts.sprint.trim().replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      jql += ` AND sprint = "${escSprint}"`;
    } else {
      jql += ' AND sprint in openSprints()';
    }
    jql += ' ORDER BY updated DESC';

    const params = new URLSearchParams({
      jql,
      fields: 'summary,status,issuetype',
      maxResults: String(MAX_ISSUE_RESULTS),
    });
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
      fields: 'summary,description,status,issuetype,subtasks,parent',
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

    const parentRaw = fields?.parent;
    const parentKey =
      parentRaw && typeof parentRaw === 'object' && typeof parentRaw.key === 'string'
        ? String(parentRaw.key)
        : undefined;

    const issue: JiraIssue = {
      key: String(body?.key ?? trimmed),
      id: String(body?.id ?? ''),
      summary: String(fields.summary ?? ''),
      status: String(fields.status?.name ?? ''),
      issueType: String(fields.issuetype?.name ?? ''),
      description,
      subtasks,
      ...(parentKey ? { parentKey } : {}),
    };

    return { ok: true, issue };
  }

  /**
   * List open epics for a project (REQ-JIRATEAM-006). Scoped to `Epic`s
   * whose statusCategory is not `Done`, ordered most-actionable-first, and
   * bounded by `MAX_ISSUE_RESULTS`. The project value is quote-escaped to
   * prevent JQL injection.
   *
   *  - 200 → the epic list (empty is a valid success).
   *  - 401 / 403 → `JiraAuthError`; redirect / network / non-200 →
   *    `JiraConfigError`.
   */
  async listEpics(projectKey: string): Promise<JiraEpic[]> {
    const project = (projectKey ?? '').trim();
    if (!project) {
      throw new JiraConfigError('A JIRA project key is required to list epics.');
    }
    const escProject = project.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const jql =
      `project = "${escProject}" AND issuetype = Epic ` +
      `AND statusCategory != Done ORDER BY updated DESC`;
    const params = new URLSearchParams({
      jql,
      fields: 'summary,status',
      maxResults: String(MAX_ISSUE_RESULTS),
    });
    const searchPath =
      this.deployment === 'datacenter'
        ? `/rest/api/2/search?${params.toString()}`
        : `/rest/api/2/search/jql?${params.toString()}`;
    const body = await this.request(searchPath);
    const raw: any[] = Array.isArray(body?.issues) ? body.issues : [];
    return raw.map((issue) => ({
      key: String(issue?.key ?? ''),
      summary: String(issue?.fields?.summary ?? ''),
      status: String(issue?.fields?.status?.name ?? ''),
    })).filter((e) => e.key.length > 0);
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
   * List the projects the authenticated user can see (REQ-JIRAPUB-009) —
   * `GET /rest/api/2/project` returns only browseable projects on both Cloud
   * and Data Center, so the list IS the user's access. Bounded to
   * `MAX_ISSUE_RESULTS` entries; an empty list is a valid success (A4).
   */
  async listProjects(): Promise<Array<{ key: string; name: string }>> {
    const body = await this.request('/rest/api/2/project');
    const raw: any[] = Array.isArray(body) ? body : [];
    return raw.slice(0, MAX_ISSUE_RESULTS).map(p => ({
      key: String(p?.key ?? ''),
      name: String(p?.name ?? ''),
    })).filter(p => p.key.length > 0);
  }

  /**
   * Assert the authenticated user can see the given project
   * (REQ-JIRATEAM-001.A4). `GET /rest/api/2/project/{key}` — a 401/403/404
   * from the repo-bound project is re-thrown with the project, host, and
   * the binding file's path, so the operator gets a directed message
   * instead of a silent fallback to another project. Non-binding paths
   * (user-level project) re-raise the original error unchanged.
   */
  async verifyProjectAccess(projectKey: string): Promise<void> {
    const key = (projectKey ?? '').trim();
    if (!key) {
      throw new JiraConfigError('A JIRA project key is required.');
    }
    try {
      await this.request(`/rest/api/2/project/${encodeURIComponent(key)}`);
    } catch (err) {
      if (this.bindingSource === 'repo' && this.bindingPath) {
        throw wrapRepoBindingProjectError(err as Error, {
          projectKey: key,
          host: this.host,
          bindingPath: this.bindingPath,
        });
      }
      throw err;
    }
  }

  /**
   * Create an issue (REQ-JIRAPUB-001) — a Story (or configured type) when
   * `parentKey` is absent, a Sub-task parented to `parentKey` when present.
   * `POST /rest/api/2/issue`; both Cloud and Data Center accept the
   * `fields.parent.key` shape for sub-task creation. Returns the new key.
   *
   * SECURITY: only spec-derived text (summary/description) and public keys
   * travel here — never a credential (REQ-JIRA-009).
   */
  async createIssue(fields: {
    projectKey: string;
    issueType: string;
    summary: string;
    description?: string;
    parentKey?: string;
    /** Optional labels — e.g. the taskship watermark (REQ-TASKSHIP-003.A4). */
    labels?: string[];
  }): Promise<{ key: string; id: string }> {
    const projectKey = (fields.projectKey ?? '').trim();
    if (!projectKey) {
      throw new JiraConfigError(
        'A JIRA project key is required to create an issue (configure "project" or pass one).',
      );
    }
    const labels = (fields.labels ?? []).map((l) => l.trim()).filter(Boolean);
    const body: any = {
      fields: {
        project: { key: projectKey },
        issuetype: { name: fields.issueType },
        summary: fields.summary,
        ...(fields.description !== undefined
          ? { description: fields.description }
          : {}),
        ...(fields.parentKey ? { parent: { key: fields.parentKey } } : {}),
        ...(labels.length ? { labels } : {}),
      },
    };
    const created = await this.write('/rest/api/2/issue', body);
    const key = typeof created?.key === 'string' ? created.key : '';
    if (!key) {
      throw new JiraConfigError(
        `JIRA at ${this.host} did not return a key for the created issue.`,
      );
    }
    return { key, id: String(created?.id ?? '') };
  }

  /**
   * Update an issue's summary and/or description (REQ-JIRAPUB-001, the
   * idempotent re-publish path). `PUT /rest/api/2/issue/{key}`; 204 on
   * success.
   */
  async updateIssue(
    key: string,
    fields: { summary?: string; description?: string },
  ): Promise<void> {
    const trimmed = (key ?? '').trim();
    if (!trimmed) {
      throw new JiraConfigError('An issue key is required (e.g., "PROJ-123").');
    }
    const patch: Record<string, unknown> = {};
    if (fields.summary !== undefined) patch.summary = fields.summary;
    if (fields.description !== undefined) patch.description = fields.description;
    if (Object.keys(patch).length === 0) return;
    await this.write(
      `/rest/api/2/issue/${encodeURIComponent(trimmed)}`,
      { fields: patch },
      'PUT',
    );
  }

  /**
   * List the plain-text bodies of an issue's comments (REQ-JIRAPUB-007's
   * idempotency check). `GET /issue/{key}/comment`; api/2 comment bodies are
   * plain strings. Bounded by JIRA's own page size — enough for a
   * contains-check, never used to mirror content.
   */
  async listComments(key: string): Promise<string[]> {
    const trimmed = (key ?? '').trim();
    if (!trimmed) {
      throw new JiraConfigError('An issue key is required (e.g., "PROJ-123").');
    }
    const body = await this.request(
      `/rest/api/2/issue/${encodeURIComponent(trimmed)}/comment`,
    );
    const raw: any[] = Array.isArray(body?.comments) ? body.comments : [];
    return raw
      .map(c => (typeof c?.body === 'string' ? c.body : ''))
      .filter(b => b.length > 0);
  }

  /**
   * List comments with their JIRA-side ids (REQ-JIRATEAM-004.A3) so a caller
   * can edit a specific comment in place instead of always appending. Same
   * `GET /issue/{key}/comment` as `listComments`, but preserving each id.
   */
  async listCommentsDetailed(key: string): Promise<Array<{ id: string; body: string }>> {
    const trimmed = (key ?? '').trim();
    if (!trimmed) {
      throw new JiraConfigError('An issue key is required (e.g., "PROJ-123").');
    }
    const body = await this.request(
      `/rest/api/2/issue/${encodeURIComponent(trimmed)}/comment`,
    );
    const raw: any[] = Array.isArray(body?.comments) ? body.comments : [];
    return raw
      .map(c => ({
        id: String(c?.id ?? ''),
        body: typeof c?.body === 'string' ? c.body : '',
      }))
      .filter(c => c.id.length > 0 && c.body.length > 0);
  }

  /**
   * Edit an existing comment in place (REQ-JIRATEAM-004.A3).
   * `PUT /issue/{key}/comment/{id}` with `{ body }`; used by the sprint
   * coverage report so re-posting updates the single watermarked comment.
   */
  async updateComment(key: string, commentId: string, body: string): Promise<void> {
    const trimmed = (key ?? '').trim();
    const id = (commentId ?? '').trim();
    if (!trimmed || !id) {
      throw new JiraConfigError(
        'An issue key and comment id are required to update a comment.',
      );
    }
    await this.write(
      `/rest/api/2/issue/${encodeURIComponent(trimmed)}/comment/${encodeURIComponent(id)}`,
      { body },
      'PUT',
    );
  }

  /**
   * Ensure a project version with `name` exists (REQ-JIRAPUB-007), creating
   * it when missing. Returns whether this call created it — a re-run finds
   * the existing version and creates nothing (A2).
   */
  async ensureProjectVersion(
    projectKey: string,
    name: string,
  ): Promise<{ created: boolean }> {
    const project = (projectKey ?? '').trim();
    const version = (name ?? '').trim();
    if (!project || !version) {
      throw new JiraConfigError(
        'A project key and a version name are required to ensure a JIRA version.',
      );
    }
    const existing = await this.request(
      `/rest/api/2/project/${encodeURIComponent(project)}/versions`,
    );
    const versions: any[] = Array.isArray(existing) ? existing : [];
    if (versions.some(v => v?.name === version)) return { created: false };
    await this.write('/rest/api/2/version', { name: version, project });
    return { created: true };
  }

  /**
   * Add a fix version to an issue (REQ-JIRAPUB-007), idempotently: when the
   * issue already carries it, no write happens. Uses the additive
   * `update.fixVersions add` shape so other fix versions are preserved.
   */
  async setFixVersion(key: string, versionName: string): Promise<{ added: boolean }> {
    const trimmed = (key ?? '').trim();
    const version = (versionName ?? '').trim();
    if (!trimmed || !version) {
      throw new JiraConfigError(
        'An issue key and a version name are required to set a fix version.',
      );
    }
    const issue = await this.request(
      `/rest/api/2/issue/${encodeURIComponent(trimmed)}?fields=fixVersions`,
    );
    const current: any[] = Array.isArray(issue?.fields?.fixVersions)
      ? issue.fields.fixVersions
      : [];
    if (current.some(v => v?.name === version)) return { added: false };
    await this.write(
      `/rest/api/2/issue/${encodeURIComponent(trimmed)}`,
      { update: { fixVersions: [{ add: { name: version } }] } },
      'PUT',
    );
    return { added: true };
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
  ): Promise<JiraHttpResponse> {
    const url = `${this.baseUrl}${path}`;

    const headers: Record<string, string> = {
      Authorization: this.authHeader,
      Accept: 'application/json',
    };
    if (jsonBody !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    let res: JiraHttpResponse;
    try {
      // With a TLS opt-in active, route through `https` (fetch/undici has no
      // per-request TLS options). Both transports refuse redirects the same
      // way — `https.request` never follows one, and the 3xx guard below
      // fires on either path.
      res = this.tls
        ? await this.sendViaTls(url, method, headers, jsonBody)
        : await fetch(url, {
            method,
            redirect: 'manual',
            headers,
            ...(jsonBody !== undefined ? { body: jsonBody } : {}),
          });
    } catch (err) {
      // Network / DNS / TLS — the message is the transport's own (no
      // credential in it), but we prepend the host, never the header.
      // Undici hides the real cause (e.g. SELF_SIGNED_CERT_IN_CHAIN) behind
      // a bare "fetch failed" — surface the cause code plus actionable
      // guidance for the common Data Center causes (REQ-JIRATLS-002).
      const msg = err instanceof Error ? err.message : String(err);
      const cause = (err as any)?.cause;
      const causeCode: string | undefined = cause?.code ?? cause?.message;
      const detail = causeCode && !msg.includes(causeCode)
        ? `${msg} (${causeCode})`
        : msg;
      throw new JiraConfigError(
        `Could not reach JIRA at ${this.host}: ${detail}. Likely causes: ` +
          `a corporate/self-signed certificate — point SPECSHIP_JIRA_CA_CERT ` +
          `at your CA bundle (or re-run "specship jira configure --ca-cert ` +
          `<pem>"; last resort: --insecure-tls); a context path — if your ` +
          `instance lives under one (e.g. https://host:8443/jira), include ` +
          `it in the base URL; or the host isn't reachable (VPN/network).`,
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

  /**
   * TLS-aware transport (REQ-JIRATLS-001): used only when a custom CA or the
   * insecure opt-in is configured. `https.request` never follows a redirect,
   * so a 3xx surfaces as-is and `send()`'s redirect guard refuses it — the
   * `Authorization` header is never replayed, same as the fetch path. TLS
   * options apply to this request only; the process default trust store is
   * untouched.
   */
  private sendViaTls(
    url: string,
    method: 'GET' | 'POST' | 'PUT',
    headers: Record<string, string>,
    jsonBody?: string,
  ): Promise<JiraHttpResponse> {
    return new Promise((resolve, reject) => {
      const req = https.request(
        url,
        {
          method,
          headers,
          ca: this.tls?.ca,
          rejectUnauthorized: this.tls?.rejectUnauthorized ?? true,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('error', reject);
          res.on('end', () => {
            const status = res.statusCode ?? 0;
            const text = Buffer.concat(chunks).toString('utf-8');
            resolve({
              status,
              ok: status >= 200 && status < 300,
              type: 'basic',
              json: async () => JSON.parse(text),
            });
          });
        },
      );
      req.on('error', reject);
      if (jsonBody !== undefined) req.write(jsonBody);
      req.end();
    });
  }
}
