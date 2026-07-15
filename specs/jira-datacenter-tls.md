---
id: JIRATLS-DOC
title: JIRA Data Center — corporate TLS and context-path base URLs
owner: specship
priority: high
---

<!-- id: JIRATLS-DOC -->
# JIRA Data Center behind corporate TLS

Enterprise JIRA Data Center instances commonly sit behind a self-signed or
corporate-CA certificate and are often served under a context path (e.g.
`https://jira2.example.com:8443/dcifjira`). SpecShip's JIRA client uses Node
`fetch`, which (correctly) rejects untrusted certificates — but today there is
no escape hatch, so `specship jira configure` fails with an opaque
"fetch failed" even when the PAT and URL are right. Reference clients (e.g.
Python `requests` with `verify=False`) work on the same instance.

Security posture is unchanged: TLS trust is only ever *widened* by explicit
user opt-in, scoped to JIRA requests only (never process-global), and no
error message or log ever contains the token/PAT (REQ-JIRA-009).

<!-- id: REQ-JIRATLS-001 -->
## The JIRA client MUST support corporate/self-signed TLS via explicit opt-in

Two opt-ins, resolved like every other JIRA setting (env over file):

- **Custom CA (preferred)** — `caCertPath` in `~/.specship/jira.json` /
  `SPECSHIP_JIRA_CA_CERT` env / `specship jira configure --ca-cert <pem>`:
  a PEM bundle trusted *in addition to nothing else* for JIRA requests.
- **Insecure (last resort)** — `insecureTls: true` / `SPECSHIP_JIRA_INSECURE_TLS=1`
  / `--insecure-tls`: disables certificate verification for JIRA requests
  only, with a loud warning at configure time. Never a default, never
  inferred, never process-global (`NODE_TLS_REJECT_UNAUTHORIZED` untouched).

When either opt-in is active the client routes requests through a TLS-aware
transport that preserves EVERY existing guard: redirects refused (never
followed), 401/403 → auth error, 404 → not-found, non-2xx → config error,
credential never in any message.

implementations:
  - src/jira/client.ts:JiraClient.sendViaTls
  - src/jira/config.ts:resolveJiraCredentials

## Acceptance
<!-- id: REQ-JIRATLS-001.A1 -->
- Against an HTTPS server with a self-signed certificate: default settings
  fail with `JiraConfigError`; `insecureTls: true` connects; `caCertPath`
  pointing at the server's PEM connects.
<!-- id: REQ-JIRATLS-001.A2 -->
- `SPECSHIP_JIRA_CA_CERT` and `SPECSHIP_JIRA_INSECURE_TLS=1` override the
  file config per-field, mirroring the other `SPECSHIP_JIRA_*` vars.
<!-- id: REQ-JIRATLS-001.A3 -->
- On the TLS transport, a 3xx response is refused (not followed), 401/403
  raises `JiraAuthError`, and no thrown message contains the PAT.
<!-- id: REQ-JIRATLS-001.A4 -->
- An unreadable `caCertPath` fails fast with a `JiraConfigError` naming only
  the path.

<!-- id: REQ-JIRATLS-002 -->
## Connection failures MUST name the likely Data Center causes

A network-level failure (fetch failed / TLS reject) surfaces the underlying
cause code when available (e.g. `SELF_SIGNED_CERT_IN_CHAIN`) and appends
actionable guidance naming: the CA/insecure opt-ins, the context-path
requirement (include it in the base URL), and network/VPN reachability —
instead of the bare "fetch failed".

implementations:
  - src/jira/client.ts:JiraClient.send

## Acceptance
<!-- id: REQ-JIRATLS-002.A1 -->
- A certificate rejection error message mentions `SPECSHIP_JIRA_CA_CERT`
  (or `--ca-cert`) and the context-path hint, and includes the TLS cause
  code — with no credential material.

<!-- id: REQ-JIRATLS-003 -->
## Base URLs with a context path MUST be honored end-to-end

A base URL like `https://host:8443/dcifjira` produces requests to
`https://host:8443/dcifjira/rest/api/2/...` on both transports; configure's
prompt/help text tells the user to include the context path if their
instance has one.

implementations:
  - src/jira/client.ts:JiraClient.send

## Acceptance
<!-- id: REQ-JIRATLS-003.A1 -->
- `testConnection()` with a context-path base URL requests
  `<contextPath>/rest/api/2/myself` (verified against a local server).
