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
| `specship reflect [path-or-verb] [hash]` | Mine ingested transcripts for self-improvement proposals; review them with apply <hash> [--yes] / undo <hash> / dismi… |
| `specship memory` | Capture lessons to memory and review/manage stored memory items. |
| `specship memory capture` | Capture a lesson/anti-pattern as a human-gated memory rule (lesson text on stdin). |
| `specship memory list` | List the memory rules SpecShip has applied (reflect-managed store). |
| `specship memory remove <id>` | Remove a SpecShip-managed memory rule by id (previewed; pass --yes to write). |
| `specship memory edit <id>` | Replace a memory rule's body with new content on stdin (previewed; pass --yes to write). |
| `specship maintainability [path]` | Report graph-derived maintainability signals (coupling, size, cycles, dead code) |
| `specship coverage [spec]` | Show spec test-coverage: per requirement and criterion, tests-link state and verdict |
| `specship lint [paths...]` | Lint spec files for authoring problems (exits non-zero on an error finding) |
| `specship knowledge <action> [id]` | Knowledge layer: stale \| check \| proposals \| apply <id> \| reject <id> |
| `specship ready <specId>` | Check a requirement is ready to implement and print its evidence plan (exits non-zero when not ready) |
| `specship postcheck <specId>` | Mechanically check an implemented requirement: verifies coverage, CHANGELOG, configured checks (exits non-zero on fai… |
| `specship verify` | Ingest a test report (vitest JSON) and promote/demote spec test links from it |
| `specship fitness [path]` | Check architecture-fitness rules against the code graph (CI gate; exits non-zero on violation) |
| `specship check [path]` | Run the enforcement gate (drift + fitness + maintainability + behaviour); exits non-zero on a gating failure |
| `specship suppressions [path]` | Scan the change under review for newly introduced lint/type suppression comments (noqa, eslint-disable, @ts-ignore, …… |
| `specship serve` | Start SpecShip as an MCP server for AI assistants (stdio transport) |
| `specship desktop` | Start the SpecShip Desktop dashboard + HTTP API (binds 127.0.0.1) |
| `specship unlock [path]` | Remove a stale lock file that is blocking indexing |
| `specship callers <symbol>` | Find all functions/methods that call a specific symbol |
| `specship callees <symbol>` | Find all functions/methods that a specific symbol calls |
| `specship impact <symbol>` | Analyze what code is affected by changing a symbol |
| `specship affected [files...]` | Find test files affected by changed source files |
| `specship install` | Install specship MCP server into Claude Code |
| `specship doctor [path]` | Diagnose a SpecShip install (runtime · FTS5 · MCP boot · index). Exits non-zero on a usage-blocking failure. |
| `specship starter-prompt [path]` | Print a suggested first flow/impact prompt for this project (used by the /specship:explore door). |
| `specship cheatsheet` | Print the SpecShip session cheat-sheet (used by the SessionStart hook). |
| `specship uninstall` | Completely remove SpecShip (wiring, indexes, ~/.specship data, and the binary) |
| `specship diagram [path]` | Generate a Mermaid flow diagram of the indexed application into docs/ (kept fresh by sync). |
| `specship pulse [path]` | Report pipeline health (release run, npm lag, JIRA auto-publish, merged run worktrees); exits non-zero on any failure. |
| `specship drifted [path]` | List spec links in concerning states (drifted, broken, orphaned). |
| `specship domain-gaps [path]` | List code entities and specs not yet covered by a domain fact (the domain gap-seed). Feeds the /specship:spec domain … |
| `specship spec [id]` | Spec lifecycle funnel (idea → spec → implemented). With an id, show that spec/brief detail. |
| `specship workflow <action> [args...]` | Workflow engine: list \| run <name> \| run-batch <name> --specs <ids> \| merge-queue <runId...> \| gc \| resume <runId> \| … |
| `specship update` | Update SpecShip to the latest released version |
| `specship jira` | Connect SpecShip to a JIRA instance (Cloud or Data Center). |
| `specship jira configure` | Save JIRA credentials to ~/.specship/jira.json (0600) and test the connection. |
| `specship jira test` | Test the configured JIRA connection (uses ~/.specship/jira.json or SPECSHIP_JIRA_* env). |
| `specship jira bind` | Write the repo JIRA binding into specship.config.json (project, epic). |
| `specship jira transition <key> [state]` | Transition a JIRA issue to <state>, or list its available transitions when <state> is omitted (or with --list). |
| `specship jira track` | Show each picked JIRA issue with its SpecShip work-state + live JIRA status. |
| `specship jira coverage` | Sprint coverage report joining JIRA sprint issues to spec truth (read-only unless --post). |
| `specship jira publish` | Publish specs to the bound JIRA project in one explicit batch (--pending: every requirement sync held back). |
| `specship jira reconcile` | Detect JIRA-side edits to published specs; --apply folds a confirmed diff back into the spec. |
| `specship jira release <version>` | Set <version> as fixVersion on JIRA issues (creating the project version if missing) with a shipped-in comment. |
| `specship jira regression-pack` | Generate / refresh the SpecShip Regression Pack in the bound JIRA project. |
| `specship jira regression-record` | Record a regression pack case result (REQ-JIRAREG-005). |
<!-- GENERATED:cli-commands END -->

A few commands aren't listed in the table above because of how they're registered, but they're fully supported: `specship maintainability [path]` (alias `maint`), `specship memory edit <id>`, and `specship jira transition <key> [state]`. Each is covered below.

Most commands that read the index accept `-j, --json` for machine-readable output, and `-p, --path <path>` (or a `[path]` argument) to target a project other than the current directory.

## Setup and install

### install

Wires SpecShip into Claude Code and prepares the current repo's `.specship/` index. Interactive installs ask only one question — where to install (`local` for this project, the default, or `global` for every project). Everything else defaults on and is named in the install summary along with its opt-out flag.

| Flag | Effect |
|---|---|
| `-l, --location <global\|local>` | Where to write the wiring. Local (the default) writes `./.mcp.json` + `./.claude/settings.json`; global writes `~/.claude.json` + `~/.claude/settings.json`. |
| `-y, --yes` | Non-interactive; defaults to `--location local`. |
| `--path <repo>` | Wire and index a specific repository instead of the current directory. |
| `--no-sdd` | Retrieval-only install: skip the spec-driven tier (the `/specship:spec`, `/specship:check`, `/specship:learn`, `/specship:day` doors, the spec-author skill and the "author a spec first" steering). The spec-driven tier is installed by default. |
| `--no-permissions` | Don't write the auto-allow permissions list (this also skips the auto-sync hooks, which run commands without prompting). |
| `--skip-statusline` | Don't add the status-line segment. It's added by default, and never replaces a status line you already have. |
| `--skip-index` | Don't index the current project. Indexing runs by default. |
| `--with-jira` | Enable the opt-in JIRA tools. In an interactive install it then offers to run `specship jira configure`. |
| `--with-designer` | Enable the opt-in, experimental Designer tools. |
| `-t, --target <ids>` | Which agents to wire: `claude` (default), `gemini`, or `claude,gemini`. Gemini CLI is opt-in and gets the MCP server entry only. |
| `--print-config` | Print the MCP config snippet and exit without writing anything. Prints the Claude Code snippet by default; add `--target gemini` for the Gemini CLI one. |

```bash
specship install                                  # one question: local or global
specship install --yes --no-sdd                   # scripted, retrieval-only
specship install --path ~/code/my-repo            # wire + index another repo
specship install --target claude,gemini           # also wire Gemini CLI
specship install --print-config --target gemini   # just print the Gemini snippet
```

After writing, install runs a quick advisory health check and reminds you to restart your agent (or run `/mcp`) — an MCP server added to the config isn't visible in a session that was already open. See [MCP & Claude Code wiring](/reference/integrations/) for exactly what gets written.

### doctor

Diagnoses an install without changing anything: the Node.js runtime, FTS5 full-text search support, whether the MCP server boots, and whether the project index can be queried. It exits non-zero on a usage-blocking failure, so it works as a gate in a provisioning script or CI step.

```bash
specship doctor
specship doctor --json
```

### uninstall

Removes SpecShip completely: the Claude Code wiring, the current project's index, the `~/.specship` directory (including saved JIRA credentials) and the `specship` program itself. It shows what it will delete and asks first; `--yes` skips the prompt. Pass `--keep-data` to only unwire from your agent and keep everything else; combine with `--target gemini` to remove just the Gemini CLI entry.

### update

Updates SpecShip to the latest release. `specship update --check` only reports whether an update is available.

## Indexing

`init` creates `.specship/` and builds the initial index in one step (the old `-i` flag is still accepted but no longer needed). `index` re-indexes everything (`--force` rebuilds from scratch), and `sync` updates only what changed. See [Indexing a project](/guides/indexing/).

## Query commands

`query`, `callers`, `callees`, and `impact` all accept `--json` for machine-readable output.

```bash
specship query UserService --kind class --limit 10
specship callers handleRequest --json
specship impact AuthMiddleware --depth 3
```

## affected

Traces import dependencies transitively to find which test files are affected by changed source files. See [Affected Tests in CI](/guides/affected-tests/) for options and a CI example.

## diagram

Draws your application's entry points and the call chains they reach as a Mermaid flowchart in `docs/flow-diagram.md`. Once the file exists, every `sync` and `index` keeps it up to date. Tune it with `-o, --output`, `--max-nodes` (default 150) and `--depth` (default 6). See [Flow diagrams](/guides/flow-diagrams/).

```bash
specship diagram
specship diagram --output docs/architecture/flows.md --depth 4
```

## Quality gate

These commands check specs, tests and code health. They're built for CI: each one exits non-zero when it finds a real problem. See [Quality gates](/specs/quality-gates/) for the gate in depth and a CI example, and [Architecture & code health](/guides/code-health/) for fitness rules and maintainability thresholds.

### check

Runs the enforcement gate in one pass: **drift**, architecture **fitness**, **maintainability**, the spec → test → verify **behaviour** chain, newly added lint/type **suppressions**, and an opt-in **mutation** score check. Every check is advisory until you opt in to gating it, so `check` never breaks an existing repo. An advisory run that finds problems ends by printing the exact command that would turn gating on.

| Flag | Effect |
|---|---|
| `--since <ref>` | Only check the requirements touched by changes since `<ref>`. Drift and behaviour are scoped to the change; fitness and maintainability always check the whole repo. An invalid ref fails rather than quietly checking everything. |
| `--strict` | Treat every check as gating for this run only. Nothing is written to config. |
| `--enable-gate <checks...>` | Save gating for the named checks into `specship.config.json`, then run the gate. |

```bash
specship check                                    # advisory report
specship check --since origin/main                # just this branch's change
specship check --enable-gate drift behaviour      # make those two gate from now on
```

### suppressions

Scans the lines added since a ref (default `HEAD`) for newly added lint/type suppression comments — `noqa`, `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `# type: ignore`, `biome-ignore` — and exits non-zero if it finds any. Moving or deleting an existing suppression never counts, and mentions in prose, strings or docs are ignored. The same scan runs as the `suppressions` check inside `specship check`.

```bash
specship suppressions --since origin/main
```

### lint

Checks spec files for authoring problems. **Errors** include missing or duplicate IDs, orphaned acceptance criteria, requirements with no acceptance criteria, and unresolved review markers. **Warnings** include a missing non-goals section or test plan, and no negative-case criterion. It reads files directly, so it needs no index and runs in a fresh checkout. It exits non-zero only on errors. With no paths it lints `specs/`.

```bash
specship lint
specship lint specs/auth.md --json
```

### coverage

Shows which requirements and acceptance criteria are backed by tests. For each one you get a verdict — `untested`, `tested`, `verified` or `broken` — based only on test links. Linked implementation code never counts as "met". Pass a spec ID to narrow it, or `--line` for just the one-line "N of M acceptance criteria …" summary.

```bash
specship coverage
specship coverage REQ-AUTH-005
```

### verify

Turns a real test run into verification. `specship verify --report <file>` reads a vitest JSON report (`vitest run --reporter=json`), matches the reported test cases to the spec's declared test links, and marks each matched link `verified` (passed) or `broken` (failed), recording which run produced the result (see [Test evidence](/specs/test-evidence/)). Unmatched cases are reported, not silently dropped, and a malformed report changes nothing. `--run-id` sets the run identifier that gets recorded.

```bash
npx vitest run --reporter=json --outputFile=report.json
specship verify --report report.json --run-id "$GITHUB_RUN_ID"
```

### fitness

Checks the architecture rules declared under `fitness.rules` in `specship.config.json` — forbidden dependencies, layering allow-lists, and module isolation — against the code graph. It exits non-zero on any violation, and also when a rule matches no files, so a typo can't produce a false pass. See [Architecture & code health](/guides/code-health/) for the rule syntax.

### maintainability

Reports maintainability signals from the graph: oversized symbols, god files and dependency cycles by default. `--deep` adds lower-confidence findings (dead-code candidates, coupling hotspots). It's advisory (exit 0) unless you pass `--strict`. Alias: `specship maint`. Thresholds are configurable — see [Architecture & code health](/guides/code-health/).

## Specs

### spec

With no argument, shows the spec lifecycle funnel (idea → spec → implemented). With an ID, shows that spec or idea brief in detail.

### drifted

Lists spec links that are `drifted`, `broken`, or `orphaned`. Add `--fail-on=broken,drifted,orphaned` to exit non-zero, so it works as a CI gate that refuses a PR that breaks a spec link.

```bash
specship drifted --fail-on=broken,drifted,orphaned
```

See [Spec links & drift](/specs/links-and-drift/).

### domain-gaps

Lists code entities and specs that no domain fact documents yet, with a documented/total count. It writes nothing; the `/specship:spec domain` capture interview uses it to suggest what to document next.

## Learning and memory

### reflect

Looks through your ingested Claude Code sessions for self-improvement proposals — memory rules, skills, hooks, project conventions, and draft domain facts. Proposals are only suggestions: nothing is written until you apply one. Each listed proposal shows a short hash: `specship reflect apply <hash>` previews the before→after diff and writes only with `--yes`, `specship reflect undo <hash>` reverses an applied proposal, and `specship reflect dismiss <hash>` hides one from future sweeps. Any unique prefix of 4+ characters works; an unknown or ambiguous prefix is refused without writing anything. `-p, --path` picks the project for these verbs. With no session history yet, it prints an empty state.

`--capture` records something on demand instead: pass `--title` and pipe the content on stdin. `--lane` picks what kind of proposal it becomes:

| Lane | Becomes |
|---|---|
| `skill` (default) | A reusable skill proposal |
| `style` | A project code-style convention, kept in `.specship/conventions.md` (never your `CLAUDE.md`) |
| `domain` | A draft domain fact under `specs/domain/` |

```bash
echo "Use the shared logger, never console.log" | specship reflect --capture --lane style --title "Logging convention"
```

The `/specship:learn` slash command does the same from inside a session. A background pass also runs during `sync`, at most once every six hours. Turn it off with `"reflect": { "autoSweep": false }` in `specship.config.json`.

### memory

Saves a lesson so the mistake isn't repeated. `memory capture --title <t>` takes the lesson text on stdin and saves it as a memory rule for you to review. `--target memory` (the default) writes to a portable `~/.claude` memory note, and `--target claude-md` writes to the project `CLAUDE.md`. `memory list` shows the rules SpecShip has applied. `memory remove <id>` deletes one, and `memory edit <id>` replaces its body with new content from stdin. Both preview the change first and only write it when you pass `--yes`.

## workflow

Drives the workflow engine from the terminal — `list`, `run <name>`, `resume <runId>`, `cancel <runId>`, `approve <runId>`, `reject <runId>`, `purge <runId>`, `runs`. Pass inputs with repeatable `-i KEY=VALUE`, and a note for approve/reject with `--comment`. Reject and cancel keep the run's worktree; only `purge` (or `gc`) deletes it. See [Workflows](/workflows/overview/).

- `run-batch <name> --specs <ID,ID,…> [--concurrency N]` starts one run per requirement (default concurrency 3). Requirements whose `implementations:` files overlap are put in later waves and never run at the same time; the chosen waves and each run id are printed.
- `merge-queue <runId…>` merges each completed run's branch into the current branch in order, re-running the project's lint/typecheck after each merge. It stops at the first conflict or failing check, leaving the tree at the last good merge. Runs that aren't completed are refused.
- `gc [--dry-run]` purges the worktrees of runs whose branch is already merged into the default branch, keeping run records and artifacts. `--dry-run` only lists them.

```bash
specship workflow run spec-implement -i SPEC_ID=REQ-AUTH-005
specship workflow run-batch spec-implement --specs REQ-AUTH-005,REQ-AUTH-006
specship workflow merge-queue <runId> <runId>
specship workflow gc --dry-run
```

## desktop

Starts the SpecShip Desktop dashboard and its HTTP API on `127.0.0.1:4242`. Options: `--port`, `--host`, `--no-ingest` (don't watch Claude Code transcripts), `--web-dir`, `--no-web` (API only), `--no-watch`, and `--mcp` to also run the MCP server in the same process. (`specship serve` is the MCP server only.)

## jira

Connects SpecShip to your JIRA board. `configure` stores credentials at `~/.specship/jira.json` (owner-only, `0600`); `test` verifies the connection and checks your configured transition names against the live workflow. The list → pick → start flow itself runs through the [MCP tools](/reference/mcp-server/) an agent calls in conversation.

```bash
# Cloud (email + Atlassian API token)
specship jira configure --base-url https://your-org.atlassian.net --email you@example.com --api-token <token>
# Data Center / Server (Personal Access Token), behind a corporate CA
specship jira configure --base-url https://jira.your-company.com --pat <token> --ca-cert ./corp-ca.pem

specship jira test                          # verify the connection ("connected as <name>")
specship jira bind --project PROJ --epic PROJ-42   # commit a shared repo binding
specship jira track                         # SpecShip work-state + live JIRA status per issue
specship jira transition PROJ-123           # list available transitions
specship jira transition PROJ-123 "In Review"
specship jira coverage --sprint "Sprint 14" # sprint issues joined to spec truth (read-only)
specship jira reconcile                     # preview JIRA-side edits to published specs
specship jira release 1.4.0                 # stamp fixVersion + shipped-in comment
specship jira regression-pack --dry-run     # plan the regression pack without writing
specship jira regression-record --case PROJ-42 --criterion REQ-FOO-001.A2 --result pass --run nightly-118
```

- **`bind`** writes the project key (and an optional default epic) into `specship.config.json`, so every teammate and CI run targets the same project. Credentials never go in that file. Once a repo is bound, every `sync` publishes new specs and refreshes changed ones automatically.
- **`coverage`** is read-only unless you pass `--post <issueKey>`, which adds the report as a single comment on that issue and edits it in place on later runs.
- **`reconcile`** only previews changes. Applying them takes `--apply` together with `--issue <key>` and the fingerprint from the preview you approved.
- **`regression-pack`** creates or refreshes the regression pack — one test case per acceptance criterion — and makes no JIRA writes when nothing changed. **`regression-record`** records one case result: `pass` moves the case to Done and marks its criterion verified, `fail` moves it to In Review and marks it broken, and `unexecuted` only adds a comment.

The token is never printed and every request is locked to the configured host. See the [JIRA integration guide](/guides/jira/).

## Environment variables

Every `SPECSHIP_*` variable the shipped code reads:

<!-- GENERATED:env-vars START — derived from source by scripts/generate-reference-docs.mjs; do not edit by hand -->
- `SPECSHIP_ADAPTIVE_EXPLORE`
- `SPECSHIP_ALLOW_UNSAFE_NODE`
- `SPECSHIP_ARTIFACTS_DIR`
- `SPECSHIP_ASCII`
- `SPECSHIP_BIN_DIR`
- `SPECSHIP_BUN_BIN`
- `SPECSHIP_CLAUDE_BIN`
- `SPECSHIP_CLI`
- `SPECSHIP_CLI_NODE`
- `SPECSHIP_CLI_SCRIPT`
- `SPECSHIP_COMPACT`
- `SPECSHIP_CTX_WARN_PCT`
- `SPECSHIP_DAEMON_IDLE_TIMEOUT_MS`
- `SPECSHIP_DAEMON_INTERNAL`
- `SPECSHIP_DEBUG`
- `SPECSHIP_DIR`
- `SPECSHIP_END`
- `SPECSHIP_EXPLORE_LINENUMS`
- `SPECSHIP_FORCE_WATCH`
- `SPECSHIP_GEMINI_RETRIEVAL_END`
- `SPECSHIP_GEMINI_RETRIEVAL_START`
- `SPECSHIP_GEMINI_STRICT`
- `SPECSHIP_HOOKS`
- `SPECSHIP_HOST`
- `SPECSHIP_HOST_PPID`
- `SPECSHIP_INSTALL_DIR`
- `SPECSHIP_INTEGRATIONS`
- `SPECSHIP_INTERCEPT_HOOKS`
- `SPECSHIP_JIRA_`
- `SPECSHIP_JIRA_API_TOKEN`
- `SPECSHIP_JIRA_BASE_URL`
- `SPECSHIP_JIRA_CA_CERT`
- `SPECSHIP_JIRA_CONFIG`
- `SPECSHIP_JIRA_DEPLOYMENT`
- `SPECSHIP_JIRA_EMAIL`
- `SPECSHIP_JIRA_INSECURE_TLS`
- `SPECSHIP_JIRA_PAT`
- `SPECSHIP_JIRA_PROJECT`
- `SPECSHIP_JIRA_TRANSITION_DONE`
- `SPECSHIP_JIRA_TRANSITION_IN_PROGRESS`
- `SPECSHIP_JIRA_TRANSITION_IN_REVIEW`
- `SPECSHIP_LEARNING`
- `SPECSHIP_MAX_DIR_WATCHES`
- `SPECSHIP_MCP_DEBUG`
- `SPECSHIP_MCP_TOOLS`
- `SPECSHIP_MODEL`
- `SPECSHIP_NO_CHEATSHEET`
- `SPECSHIP_NO_DAEMON`
- `SPECSHIP_NO_PULSE`
- `SPECSHIP_NO_RELAUNCH`
- `SPECSHIP_NO_STATUSLINE_TIPS`
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
- `SPECSHIP_UNICODE`
- `SPECSHIP_USAGE_FILE`
- `SPECSHIP_UV_BIN`
- `SPECSHIP_VERBOSE`
- `SPECSHIP_WASM_RELAUNCHED`
- `SPECSHIP_WATCH_DEBOUNCE_MS`
<!-- GENERATED:env-vars END -->
