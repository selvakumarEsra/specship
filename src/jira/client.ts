/**
 * Minimal JIRA REST client (REQ-JIRA-001, A3).
 *
 * Wraps `fetch` with the base URL + auth header. Only surface today is
 * `testConnection()`, which probes `/rest/api/2/myself` (available on
 * both Cloud and Data Center).
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
  JiraConfigError,
  JiraAuthError,
} from './types';

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
    const url = `${this.baseUrl}/rest/api/2/myself`;

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

    let body: any;
    try {
      body = await res.json();
    } catch {
      throw new JiraConfigError(
        `JIRA at ${this.host} returned a non-JSON response.`,
      );
    }

    return {
      ok: true,
      // Cloud → accountId; Data Center → key/name. Prefer the most stable.
      accountId: body?.accountId ?? body?.key ?? body?.name,
      displayName: body?.displayName ?? body?.name,
    };
  }
}
