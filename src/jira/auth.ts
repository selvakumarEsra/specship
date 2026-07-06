/**
 * JIRA auth header construction (REQ-JIRA-001, A1).
 *
 *  - **Cloud** → HTTP Basic: `base64(email:apiToken)`.
 *  - **Data Center** → `Bearer <pat>`.
 *
 * SECURITY: the returned string embeds the secret. Callers must treat it
 * as sensitive — never log it, never put it in an error message.
 */

import { JiraCredentials, JiraConfigError } from './types';

/**
 * Build the `Authorization` header value for a JIRA request.
 * Throws `JiraConfigError` (with a message that never contains the
 * secret) when the credentials don't match the deployment.
 */
export function buildAuthHeader(creds: JiraCredentials): string {
  if (creds.deployment === 'cloud') {
    if (!creds.email || !creds.apiToken) {
      throw new JiraConfigError(
        'JIRA Cloud requires both an email and an API token.',
      );
    }
    const basic = Buffer.from(`${creds.email}:${creds.apiToken}`).toString(
      'base64',
    );
    return `Basic ${basic}`;
  }

  // Data Center / Server
  if (!creds.pat) {
    throw new JiraConfigError(
      'JIRA Data Center requires a personal access token.',
    );
  }
  return `Bearer ${creds.pat}`;
}
