---
title: CLI
description: Every SpecShip command and the flags it accepts.
---

<!-- GENERATED:cli-commands START — derived from source by scripts/generate-reference-docs.mjs; do not edit by hand -->
| Command | What it does |
|---|---|
| `specship init [path]` | Initialize SpecShip in a project directory and build the initial index |
| `specship uninit [path]` | Remove SpecShip from a project (deletes .specship/ directory) |
| `specship index [path]` | Index all files in the project |
| `specship sync [path]` | Sync changes since last index |
| `specship status [path]` | Show index status and statistics |
| `specship statusline` | Print a SpecShip status-line segment (reads Claude Code JSON on stdin) |
| `specship query <search>` | Search for symbols in the codebase |
| `specship files` | Show project file structure from the index |
| `specship reflect [path]` | Mine ingested transcripts for self-improvement proposals (memory rules, skills, hooks) |
| `specship fitness [path]` | Check architecture-fitness rules against the code graph (CI gate; exits non-zero on violation) |
| `specship check [path]` | Run the enforcement gate (drift + fitness + maintainability + behaviour); exits non-zero on a gating failure |
| `specship serve` | Start SpecShip as an MCP server for AI assistants, an HTTP API for the desktop UI, or both |
| `specship unlock [path]` | Remove a stale lock file that is blocking indexing |
| `specship callers <symbol>` | Find all functions/methods that call a specific symbol |
| `specship callees <symbol>` | Find all functions/methods that a specific symbol calls |
| `specship impact <symbol>` | Analyze what code is affected by changing a symbol |
| `specship affected [files...]` | Find test files affected by changed source files |
| `specship install` | Install specship MCP server into Claude Code |
| `specship doctor [path]` | Diagnose a SpecShip install (runtime · FTS5 · MCP boot · index). Exits non-zero on a usage-blocking failure. |
| `specship starter-prompt [path]` | Print a suggested first flow/impact prompt for this project (used by the /specship:explore door). |
| `specship uninstall` | Completely remove SpecShip (wiring, indexes, ~/.specship data, and the binary) |
| `specship drifted [path]` | List spec links in concerning states (drifted, broken, orphaned). |
| `specship domain-gaps [path]` | List code entities and specs not yet covered by a domain fact (the domain gap-seed). Feeds the /specship:spec domain … |
| `specship spec [id]` | Spec lifecycle funnel (idea → spec → implemented). With an id, show that spec/brief detail. |
| `specship workflow <action> [arg]` | Workflow engine: list \| run <name> \| resume <runId> \| cancel <runId> \| approve <runId> \| reject <runId> \| purge <runI… |
| `specship update` | Update SpecShip to the latest released version |
| `specship jira` | Connect SpecShip to a JIRA instance (Cloud or Data Center). |
| `specship jira configure` | Save JIRA credentials to ~/.specship/jira.json (0600) and test the connection. |
| `specship jira test` | Test the configured JIRA connection (uses ~/.specship/jira.json or SPECSHIP_JIRA_* env). |
| `specship jira track` | Show each picked JIRA issue with its SpecShip work-state + live JIRA status. |
<!-- GENERATED:cli-commands END -->

## Query commands

`query`, `callers`, `callees`, and `impact` all accept `--json` for machine-readable output.

```bash
specship query UserService --kind class --limit 10
specship callers handleRequest --json
specship impact AuthMiddleware --depth 3
```

## affected

Traces import dependencies transitively to find which test files are affected by changed source files. See [Affected Tests in CI](/guides/affected-tests/) for options and a CI example.

## drifted

Lists spec links that are `drifted`, `broken`, or `orphaned`. Add `--fail-on=broken,drifted,orphaned` to exit non-zero, so it works as a CI gate that refuses a PR that breaks a spec link.

```bash
specship drifted --fail-on=broken,drifted,orphaned
```

See [Spec links & drift](/specs/links-and-drift/).

## workflow

Drives the workflow engine from the terminal — `list`, `run <name>`, `resume <runId>`, `cancel <runId>`, `approve <runId>`, `reject <runId>`, `runs`. Pass inputs with repeatable `-i KEY=VALUE`. See [Workflows](/workflows/overview/).

```bash
specship workflow run spec-implement -i SPEC_ID=REQ-AUTH-005
```

## jira

Connects SpecShip to your JIRA board. `configure` stores credentials at `~/.specship/jira.json` (owner-only, `0600`); `test` verifies the connection; `track` shows the status of the issues SpecShip has picked. The list → pick → start flow itself runs through the [MCP tools](/reference/mcp-server/) an agent calls in conversation.

```bash
# Cloud (email + Atlassian API token)
specship jira configure --base-url https://your-org.atlassian.net --email you@example.com --api-token <token>
# Data Center / Server (Personal Access Token)
specship jira configure --base-url https://jira.your-company.com --pat <token>

specship jira test                 # Verify the connection ("connected as <name>")
specship jira track                # Status of picked issues (--project to narrow, --path)
```

The token is never printed and every request is locked to the configured host. See the [JIRA integration guide](/guides/jira/).

## Environment variables

Every `SPECSHIP_*` variable the shipped code reads:

<!-- GENERATED:env-vars START — derived from source by scripts/generate-reference-docs.mjs; do not edit by hand -->
- `SPECSHIP_ADAPTIVE_EXPLORE`
- `SPECSHIP_ALLOW_UNSAFE_NODE`
- `SPECSHIP_ASCII`
- `SPECSHIP_BIN_DIR`
- `SPECSHIP_BUN_BIN`
- `SPECSHIP_CLAUDE_BIN`
- `SPECSHIP_COMPACT`
- `SPECSHIP_CTX_WARN_PCT`
- `SPECSHIP_DAEMON_IDLE_TIMEOUT_MS`
- `SPECSHIP_DAEMON_INTERNAL`
- `SPECSHIP_DEBUG`
- `SPECSHIP_DIR`
- `SPECSHIP_END`
- `SPECSHIP_EXPLORE_LINENUMS`
- `SPECSHIP_FORCE_WATCH`
- `SPECSHIP_HOOKS`
- `SPECSHIP_HOST_PPID`
- `SPECSHIP_INSTALL_DIR`
- `SPECSHIP_INTEGRATIONS`
- `SPECSHIP_JIRA_`
- `SPECSHIP_JIRA_API_TOKEN`
- `SPECSHIP_JIRA_BASE_URL`
- `SPECSHIP_JIRA_CA_CERT`
- `SPECSHIP_JIRA_CONFIG`
- `SPECSHIP_JIRA_DEPLOYMENT`
- `SPECSHIP_JIRA_EMAIL`
- `SPECSHIP_JIRA_INSECURE_TLS`
- `SPECSHIP_JIRA_PAT`
- `SPECSHIP_JIRA_TRANSITION_IN_PROGRESS`
- `SPECSHIP_JIRA_TRANSITION_IN_REVIEW`
- `SPECSHIP_LEARNING`
- `SPECSHIP_MAX_DIR_WATCHES`
- `SPECSHIP_MCP_DEBUG`
- `SPECSHIP_MCP_TOOLS`
- `SPECSHIP_MODEL`
- `SPECSHIP_NO_DAEMON`
- `SPECSHIP_NO_RELAUNCH`
- `SPECSHIP_NO_STEERING`
- `SPECSHIP_NO_WATCH`
- `SPECSHIP_PPID_POLL_MS`
- `SPECSHIP_PREFIX`
- `SPECSHIP_PROJECT_ROOT`
- `SPECSHIP_RESOLVER_CACHE_SIZE`
- `SPECSHIP_SDD_HOOKS`
- `SPECSHIP_SDD_SECTION_END`
- `SPECSHIP_SDD_SECTION_START`
- `SPECSHIP_SERVER_CONFIG`
- `SPECSHIP_SQLITE_BACKEND`
- `SPECSHIP_START`
- `SPECSHIP_STATUSLINE`
- `SPECSHIP_STEER_HOOKS`
- `SPECSHIP_TOOLDEF_CHARS`
- `SPECSHIP_UNICODE`
- `SPECSHIP_USAGE_FILE`
- `SPECSHIP_UV_BIN`
- `SPECSHIP_VERBOSE`
- `SPECSHIP_WASM_RELAUNCHED`
- `SPECSHIP_WATCH_DEBOUNCE_MS`
<!-- GENERATED:env-vars END -->
