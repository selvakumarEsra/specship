# Changelog

All notable changes to SpecShip are documented here. Each entry also ships as
a [GitHub Release](https://github.com/selvakumarEsra/specship/releases) tagged
`vX.Y.Z`, which is where most people will look.

This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### New Features

- **SpecShip's slash commands now live under a `/specship:` namespace.** The commands you type in Claude Code are now `/specship:spec`, `/specship:explore`, and `/specship:check` — grouped under one `specship:` prefix instead of scattered among your other commands. Upgrading removes the old flat `/ss-*` commands so you don't end up with duplicates, and the installer prints a one-time note pointing out the new names. The dashboard chat still understands the old `/ss-*` forms and tells you what each was renamed to, so nothing you've memorized suddenly stops working.
- **Design imports moved into the spec door: `/specship:spec design`.** Pass a `claude.ai/design` URL to import a settled design, a `figma.com` URL to import through the Figma MCP, or no URL to run the live taste loop first — all three feed the same snapshot → spec → implement pipeline. The standalone `/specship:design-implement` and `/specship:design-loop` commands are retired, and upgrading removes their old command files.
- **`/specship:spec` now handles free text gracefully.** Input that isn't a spec ID or a known sub-command gets one clarifying question — new, fast, or triage — leading with a recommendation inferred from what you pasted (an error log points at triage; a feature idea points at new or fast) instead of undefined behaviour.
- **Every authored spec is reviewed before hand-off.** All three authoring paths (`new`, `fast`, `design`) end with the same automatic review pass: structural problems are fixed on the spot, and judgement calls surface as a single proceed/adjust prompt — so no spec reaches disk unreviewed, including on the fast path.
- **Anything broken goes in through triage.** `/specship:spec triage` now consults the drift queue after matching the owning spec — when the real problem is a stale spec↔code link it routes you to the fix flow instead of appending a criterion — and `/specship:check` given free text hands it to triage rather than failing.
- **Spec authoring and implementation no longer stall in plan mode.** The spec command now exits Claude Code's plan mode at the confirmed-write and implement hand-off boundaries — the spec is the plan, and the implement workflow carries its own plan/approve gate — instead of letting plan mode block the spec write or the workflow launch.
- **Drift now comes to you instead of waiting to be found.** The moment an edit drifts a spec↔code link, the auto-sync prints a one-line notice naming the spec and the fix; and when a session starts with drifted links in the queue, you get a one-line count pointing at `/specship:check drifted`. Already-drifted links stay quiet — you're told once, at the moment it happens.
- **Impact analysis now shows the specs governing the blast radius.** When symbols in `specship_impact`'s radius carry spec links, the output lists each governing spec with the link's kind and state, and ends with guidance to re-assert the links after the change — so you learn a change touches a verified promise before making it, not from the drift queue afterwards.
- **A graduated path from advisory checks to a real gate.** `specship check --strict` gates every check for one run; `specship check --enable-gate <checks…>` turns gating on permanently and writes the config for you; advisory runs whose findings would fail a gated run now end with that exact command; and the spec-driven (`--sdd`) install asks once whether to gate drift & behaviour, recommended on. With no config and no flags, `specship check` still reports advisory findings and exits zero.
- **A spec can no longer be marked verified when its tests never ran.** The bundled implement workflow now reports whether the test suite ran-and-passed, ran-and-failed, or was skipped (no recognised test framework) in a machine-readable way, and a skipped run leaves spec links at `implemented` instead of `verified`. The final approval also reports how many of the spec's acceptance criteria have linked tests, naming `/specship:spec behaviour` as the follow-up that closes any gap.
- **Releases now run a real browser check of the dashboard before publishing.** A new end-to-end test opens the dashboard in a headless browser at `127.0.0.1`, against a self-contained sample project, and confirms it actually renders live data with no blocked API calls. It runs on pull requests and as a blocking gate during release — so the "dashboard opens blank / shows no data" class of bug can't ship unnoticed.


## [0.11.7] - 2026-07-02

### Fixes

- **The dashboard loads whether you open it at `localhost` or `127.0.0.1`.** Opening the dashboard at `http://127.0.0.1:<port>` showed no data — every API call (and the live-update streams) went to `localhost` instead of the page's own host, and the browser blocked the cross-origin requests. The dashboard now calls the API at the same origin it was served from, and the live-update (SSE) endpoints send the right CORS headers, so it works from either address.

## [0.11.6] - 2026-07-01

### New Features

- **Dashboard chat replies now stream in as they're composed.** Asking a question in the dashboard chat now reveals the answer progressively — a thinking indicator, the real query being run, its result summary, then the answer typing in chunk by chunk — instead of appearing all at once after a fixed delay. The reply is still answered entirely from your project's own indexed graph, specs, and domain facts with no language model, so the tool-call card shows the actual capability and a truthful result count, and no model name, cost, or token figure is shown. Closing the page mid-answer ends the stream cleanly.
- **Dashboard chat now shows the full detail behind every match, not just a summary.** Below each answer, every matched symbol, spec, and domain fact gets its own expandable section holding exactly what the graph retrieved — a symbol's verbatim source, its signature, and its immediate callers and callees; a spec's full body and the code it links to with each link's state; a domain fact's full body — so you can read the real detail without leaving the chat. The concise answer stays on top; the detail set is ranked by relevance and capped so a broad question can't flood the page.

## [0.11.5] - 2026-07-01

### New Features

- **The status line warns before your context fills up.** When Claude Code reports how much of the context window is in use, the `specship statusline` segment now shows a `CTX` bar with the percentage used, and escalates to a `⚠ compact` hint once it crosses a threshold (default 80%, set `SPECSHIP_CTX_WARN_PCT` to change it) — a heads-up to compact before the conversation gets inefficient. It's advisory only: SpecShip surfaces the real number Claude provides but can't compact for you (the host handles that, and already auto-compacts near the limit).

## [0.11.4] - 2026-07-01

### New Features

- **Offline installs no longer need npm or a compiler.** Every release bundle is now self-installing on an air-gapped machine: extract the `specship-<target>` archive and run the `install.sh` (`install.ps1` on Windows) baked inside it — it puts `specship` on your `PATH` and wires Claude Code using only the bundled Node runtime, with nothing compiled or downloaded on the target. Pass `--skip-claude` to install onto `PATH` only, or `--uninstall` to reverse it. `scripts/offline-install.sh` now installs from a pre-built bundle instead of building from source, so it works where there's no toolchain.
- **The status line can now show your Claude usage limits.** On Pro/Max, the `specship statusline` segment reads Claude Code's own 5-hour and weekly rate-limit data (provided on the status-line input) and shows how much of each window you've used as bars with reset times in your local timezone — e.g. `5h ❮▰▰▰▱▱❯ 58% (4pm) ◆ 7d ❮▰▱▱▱▱❯ 27% (6/29, 2pm)`. No extra tooling needed. SpecShip only displays the real numbers Claude provides; a window with no data (free tier, or before the first response of a session) is simply hidden — never estimated. An optional `SPECSHIP_USAGE_FILE` (`~/.specship/usage-limits.json`) can supply the numbers for setups that don't get them on stdin.

### Fixes

- **Release bundles always contain the latest UI and code.** Building a bundle from a checkout could ship a stale or missing dashboard UI (the dashboard is a separate package whose dependencies the top-level install doesn't fetch), and stale compiled files from renamed/deleted source could linger in the build. Now the dashboard build installs its own dependencies when they're missing, and `scripts/build-bundle.sh` wipes the previous build before recompiling — so every bundle is assembled from a wholly fresh build of the current source, even on a clean checkout.

## [0.11.3] - 2026-06-30

### Fixes

- **`specship install` works again on the bundled package.** The first bundled release (0.11.2) shipped only its runtime, dropping the slash-command and subagent files the installer copies — so a fresh `specship install` failed with `ENOENT … /commands/ss-explore.md`. The build now ships those assets inside the bundle and the installer finds them, on both the bundled and the plain package. Upgrade with `npm i -g @specship/specship@latest` and re-run `specship install`. (Affected anyone who installed 0.11.2.)

## [0.11.2] - 2026-06-29

### Fixes

- **0.11.2 is the first properly bundled build.** 0.11.0 and 0.11.1 were published as the plain (non-bundled) package by mistake; 0.11.2 ships the per-platform bundled distribution — it carries its own Node runtime and a prebuilt SQLite, so `npm i -g @specship/specship` installs with no native-compile step and no `prebuild-install` deprecation noise, on any supported Node. Same features as 0.11.0/0.11.1. Upgrade with `npm i -g @specship/specship@latest`.

## [0.11.1] - 2026-06-29

### Fixes

- **0.11.1 ships the proper bundled build.** 0.11.0 briefly went out as a plain (non-bundled) package; 0.11.1 is the per-platform bundled distribution — it carries its own Node runtime and a prebuilt SQLite, so `npm i -g @specship/specship` installs and runs on any supported Node with no native compile step. Same features as 0.11.0. Upgrade with `npm i -g @specship/specship@latest`.

## [0.11.0] - 2026-06-29

### Breaking Changes

- **SpecShip now publishes under a new npm name: `@specship/specship` (was `@selvakumaresra/specship`).** The package moved to the `specship` organization. Existing global installs keep working but won't see new releases — switch over with `npm uninstall -g @selvakumaresra/specship && npm install -g @specship/specship` (and update any `npx @selvakumaresra/specship …` invocations or MCP-server entries to `@specship/specship`). The CLI, the `specship` binary, and every command are otherwise unchanged. The old package is deprecated with a pointer to the new one.
- **The slash commands are now a few progressive "doors" instead of a long flat list.** The per-action `ss-*` commands are consolidated into three: **`/ss-explore`** (reads — explore / trace / impact), **`/ss-spec`** (the whole intent loop — `/ss-spec` to view the funnel, `/ss-spec <ID>` to view a spec, and `new` / `fast` / `implement` / `review` / `triage` / `behaviour` / `domain` sub-actions), and **`/ss-check`** (the gate, drift queue, link repair, and code-health). `/ss-spec fast <description>` is a new fast-path that records intent and heads straight to implementation, skipping the brainstorm/gap-question interview. Upgrading cleans up the old `ss-*` command files automatically, and your own commands are never touched. (The design→code commands are unchanged.)
- **A default `specship install` now sets up retrieval only; spec-driven development is opt-in.** Installing SpecShip wires up the code-intelligence tools and the retrieval slash commands, but no longer installs the spec-authoring/implement/review/design commands or the "author a spec first" nudge unless you ask for them with `specship install --sdd`. This keeps a first install focused on the thing that needs no workflow change — your agent exploring the index instead of re-reading files — and lets you opt into the spec-driven layer when you're ready. The old `--no-sdd` opt-out flag is replaced by the `--sdd` opt-in. Re-run `specship install --sdd` to get the full spec-driven surface; an existing spec-driven install is preserved on upgrade (never silently downgraded).

### New Features

- **Your first session shows you what SpecShip is for.** After indexing, `specship init` (and the install step) suggests a concrete question tailored to *your* repo — e.g. *"How does `GET /api/...` reach `<function>`?"* — so you can watch Claude answer a real cross-file question by exploring the index instead of reading files. The same suggestion appears when you run `/ss-explore` with no arguments, and it bows out automatically once you've started using retrieval this session. It only ever suggests a flow it has verified actually connects (and never a test fixture or a generic throwaway name), so the first thing you try always lands.
- **`specship install` now proves it worked and tells you the one thing to do next.** After wiring up Claude Code it runs a quick check — runtime, full-text search, that the MCP server boots, and that your index is queryable — and prints a clear ✓/✗ for each (advisory: it never fails your install). It then reminds you to **restart Claude Code (or run `/mcp`)**, since a server added mid-session isn't visible until you reconnect — the most common "it didn't work" surprise.
- **New `specship doctor` command diagnoses a SpecShip install.** Run it anytime to re-check runtime, full-text search (FTS5), MCP-server boot, and index queryability; it's read-only and exits non-zero on a problem that would actually block use, so you can drop it into a script or CI. It's the quickest way to catch a host whose runtime lacks the full-text search SpecShip needs — with the exact fix to apply.
- **`specship install` offers to index the current project.** Run it inside a project and it asks whether to build the index right there, so your first project is ready to explore without a separate `specship init` step. Under `--yes` it indexes by default (pass `--skip-index` to opt out for automation); it never re-indexes an already-indexed project and never indexes silently.
- **`specship maintainability` now leads with the findings you can trust.** The report shows the high-signal classes by default — oversized symbols, god files, and dependency cycles — each ranked and capped with an "…and N more" note, instead of burying them under a thousand low-confidence guesses. Dead-code candidates and coupling hotspots (which are noisier — high volume, and fan-in counts inflated by same-named methods) are hidden behind `specship maintainability --deep`, clearly labelled as lower-confidence. `--json` is unchanged for tooling: it still returns every finding, now tagged by tier so CI can choose what to gate on.
- **Show SpecShip status in your Claude Code status line.** A new `specship statusline` command reads Claude Code's status-line data and prints a single styled segment — index sync state (synced, or how many files are pending), drift-queue count, a warning when the database is on a slow non-WAL path, the number of specship lookups made this session, and the active workflow run. Pipe it into your own status-line script to keep it composable with whatever else you show. It reads only small cache files (never the database), so it stays fast enough to render on every keystroke, and honors `NO_COLOR`. It never shows a "tokens saved" figure — that would require a counterfactual that doesn't exist at runtime; the honest signal it shows instead is how many times specship was actually called. During `specship install` you can opt in to having the segment wired up for you (or pass `--statusline`) — and if you already have a status line, it's left untouched and you get the one-line snippet to add yourself.
- **Generate end-to-end tests from a requirement's acceptance criteria.** Ask `specship_spec` for a requirement's *behaviour surface* and it returns the code that requirement links to plus the routes, components, and handlers around it, split into a UI tier (Playwright targets) and a backend/batch tier (API/job targets). The new `/ss-behaviour <REQ-ID>` command builds on it: for each acceptance criterion it authors a Playwright UI test and/or a backend test — mirroring your project's existing test setup — shows them to you before writing, links each test to the criterion it covers, then runs them and records pass/fail into the spec→test→verify chain that `specship check` gates on. A suite that can't run is reported as unrun rather than counted as a failure, and a project with no UI gets backend tests only.
- **The desktop dashboard fills in its remaining screens.** A new **MCP** page lists every Model Context Protocol server you have configured — global and project — each with its tools, live status, the clients using it, and its config. You can launch a workflow straight from its card (filling in its inputs first); open any past prompt in a session as its own page with a rule-based **prompt-quality** read that tells you what to tighten and suggests a rewrite; explore your **whole** code graph with switchable hierarchical / force / anchored layouts instead of one symbol at a time; and browse a workflow run's artifacts inline. The Specs, Compare, and Chat screens pick up matching polish.

### Fixes

- **Acceptance criteria are now indexed as their own spec entities.** Writing acceptance criteria the documented way — id-marked bullets under a `## Acceptance` heading — now produces a queryable, linkable spec node per criterion, so you can attach a test to a specific `.A<N>` criterion and the enforcement behaviour gate counts it. Previously the `## Acceptance` heading raised a spurious "missing id" error and the criteria were silently dropped; existing specs pick up their criteria automatically on the next index, with no edits needed. A criterion whose id names a different requirement than the one it's written under is flagged with a warning, and a literal `<!-- id: … -->` written inside a bullet's prose is no longer mistaken for a real marker.

## [0.10.0] - 2026-06-28

### New Features

- **See where your codebase is getting risky — straight from the graph.** A new maintainability harness surfaces coupling hotspots (highly-depended-on symbols), oversized symbols and god-files, dependency cycles, and dead-code candidates — all derived from the index with no extra parse, each finding telling you why it flagged. Run `specship maintainability` in your terminal, open the **Maintainability** page in the dashboard, or let your agent call it. Tune the thresholds per project in `specship.config.json`.
- **Enforce architecture rules your agent must follow.** Declare rules in `specship.config.json` — forbid a module from importing another, set a layering allow-list, or mark a module as isolated — and `specship fitness` checks them against the real dependency graph, reporting each violation with its source → target and `file:line`. It exits non-zero so it can gate CI, and a rule whose target matches nothing is reported as a config error rather than silently passing. Your agent can run it too via `specship_fitness`.
- **One command to gate AI-assisted changes — opt-in, never surprising.** `specship check` composes drift, architecture fitness, maintainability, and a spec→test→verify behaviour check into a single CI gate. It's strictly opt-in: with no `enforce` config it only advises and exits 0, so adding it to an existing repo never breaks the build; turn on whichever checks you want to gate, one at a time, in `specship.config.json`.

- **Capture your project's domain knowledge as first-class facts.** SpecShip now recognizes a new `domain` spec kind — terms, rules, decisions, and constraints authored as Markdown under `specs/domain/`. Each fact declares a `type` (`term`, `rule`, `decision`, or `constraint`), is indexed and full-text searchable alongside your other specs, and shows up in `specship_explore` and `specship_search`. An unrecognized `type` still indexes the fact and surfaces a parse warning rather than dropping it.
- **Domain facts inherit the code they govern through the specs they link to.** A domain fact attaches to one or more requirement specs via `parent_id` / `depends_on` in its frontmatter — it never links straight to code. `specship_spec` on a fact now shows an **Inherited code** section listing the code those requirements implement, grouped by requirement, with each link's live state — so when that code drifts, the fact reflects it automatically, with no separate drift tracking. A fact captured before any requirement is linked indexes cleanly and is shown as an unlinked gap rather than an error.
- **Domain facts surface through the tools you already use — no new tool to learn.** `specship_spec` on a requirement now lists the domain facts linked to it inline under **Domain facts**, and naming a documented term or entity in `specship_explore` returns that fact's confirmed wording alongside the code — so the project's ubiquitous language and business rules show up right where you're already looking.
- **See what your domain layer doesn't cover yet.** The new `specship domain-gaps` command lists the code entities (classes, structs, interfaces, routes, components) and specs that no domain fact documents, with a `documented · gaps` coverage rollup. It's read-only and writes nothing; add `--json` to feed it into tooling.
- **New `/ss-domain` command captures a domain fact with you in the loop.** It grounds in your repo with `specship_explore`, uses `specship domain-gaps` to ask targeted, per-type questions about the *actual* undocumented entities and specs (not a generic "describe your domain" prompt), and writes a fact under `specs/domain/` **only after you explicitly confirm** — nothing reaches disk otherwise. Hand-authoring the same Markdown file and running `specship sync` produces the identical indexed result, so the command is a convenience, never a gate.
- **Browse your domain knowledge in the dashboard.** A new **Domain** page groups every fact by type — Terms, Rules, Decisions, Constraints — as readable cards, with a `documented · gaps` coverage strip up top. Each card shows the fact, what it governs, and a live verified/drifted state chip (with a **Review** shortcut when the governed code has drifted); an empty layer prompts you to capture your first fact.
- **Installs now steer claude.ai/design links to the design loop.** `specship install` writes a short rule into your project's `CLAUDE.md` so that when you share a `claude.ai/design` link, Claude recommends `/ss-design-loop` (taste the design → spec → review → implement) and confirms with you before proceeding — even mid spec-author. Skip it with `--no-sdd`; `specship uninstall` removes it.
- **Search your specs by plain text to find where a change belongs.** `specship_spec` gains a `query` mode: give it a free-text description — a bug, an error, a one-line enhancement — and it returns the existing specs that best match, ranked with a relevance score and a matched snippet, so you can route a small change to the right requirement instead of spawning a new doc. Calling it with no argument (the lifecycle funnel) or with a spec id (the spec's detail) works exactly as before.
- **New `/ss-triage` command routes a small change to the spec it belongs to.** Hand it a bug, an error log, or a one-line enhancement and it classifies the input, finds the existing spec it belongs to (prose via spec search; error logs by walking the failing code to the spec it implements), and — **only after you confirm the exact change** — appends a new requirement or acceptance criterion to that spec rather than spawning a new doc. When nothing fits, it says so and offers to author a new spec instead; it never creates one on its own.

## [0.6.0] - 2026-06-25

### New Features

- **See your spec pipeline at a glance — from brainstormed idea to shipped code.** A new spec lifecycle funnel shows, for the whole project, how many brainstormed ideas you have, how many became specs, and how many requirements are implemented versus verified. The brainstorm briefs that `/ss-brainstorm` writes are now first-class and full-text searchable, linked to the spec they turned into (and flagged when an idea isn't linked to anything yet, or when a brief and a spec disagree about the link). View it three ways: run `specship spec` in your terminal, call `specship_spec` with no argument from Claude Code, or open the **Specs** page in the dashboard — which now lists your idea-stage briefs alongside the specs they became.

### Fixes

- **Spec documents now report their requirements correctly.** A document was being indexed as its own child, so anything that walked a document's requirements — drift checks and the new lifecycle funnel — could miscount by including the document itself. Documents now index cleanly with their requirements beneath them; a re-index repairs any project already affected.

## [0.5.0] - 2026-06-24

### New Features

- **New `/ss-brainstorm` command for confirmation-gated requirement exploration.** Grounds your idea in the existing codebase (using `specship_explore`), proposes 2–3 approaches with trade-offs, and iterates with you one question at a time — but writes nothing to disk until you explicitly confirm. On confirmation it writes a `specs/<slug>/brief.md` capturing the discussion and hands off to `/ss-spec-author` to produce the formal spec, then links the two documents both ways.
- **See SpecShip's token impact in the dashboard.** A new **SpecShip Impact** page puts the tokens SpecShip's own tool calls consumed (measured, exact) next to an estimate of how many tokens it saved by answering structural questions from the graph instead of reading whole files — broken down per prompt, per session, per project, and across all projects, with a spend-vs-saved trend and a per-tool breakdown. Session Detail also gains a per-prompt SpecShip chip and a per-session spent/saved/net line. "Saved" is a deliberately conservative **lower bound**: it credits only a single direct read of the files a query's symbols live in — not the multi-call grep + read exploration and extra turns SpecShip actually replaces — so it under-claims rather than over-claims, and a query with no resolvable symbols counts as zero. Cost is priced at your model's input rate, and every estimate is marked `est.`. Run `specship serve --ui` and open **SpecShip Impact**.

### Fixes

- **`specship install --yes` help text now matches its behavior.** The `--yes` flag's help (and the matching `uninstall` help) said it defaulted to a global install; the non-interactive default has been project-local since 0.4.0. The text now reads `--location=local`, so `specship install --help` no longer implies the wrong scope. Pass `--location global` for the old behavior.

## [0.4.0] - 2026-06-23

### Breaking Changes

- **Slash command prefix renamed from `cg-` to `ss-`.** All bundled slash commands now use the `ss-` (SpecShip) prefix instead of the legacy `cg-` (code graph, historical) prefix. The new commands are `/ss-sync`, `/ss-trace`, `/ss-explore`, `/ss-impact`, `/ss-spec`, `/ss-implement`, `/ss-drifted`, `/ss-fix`, `/ss-relink`, `/ss-spec-author`, `/ss-spec-review`. Re-run `specship install` to migrate — the installer self-heals by removing any `cg-*.md` files a previous installer wrote, so you won't end up with both prefixes side-by-side cluttering the autocomplete. Aliases, scripts, or docs that reference the old `/cg-*` names need a one-time find-and-replace.
- **`specship install` now defaults to project-local instead of global.** A no-flag `specship install` writes the MCP server entry + permissions + hooks to `./.mcp.json` and `./.claude/settings.json` (project-scoped) instead of `~/.claude.json` and `~/.claude/settings.json` (global). This keeps SpecShip's MCP tool surface out of Claude Code sessions on projects that haven't opted in — saving ~3k tokens of always-on tool-list overhead per session on unrelated projects. Pass `--location global` to get the old behavior. The matching `specship uninstall` default also flipped so an `--yes` install/uninstall pair stays symmetric. Existing global installs are untouched until you re-run `specship install` or `specship uninstall` against them.

### New Features

- **`specship install` now steers feature/bug work to spec-author first.** A fresh install writes a short spec-driven-development rule into your project's CLAUDE.md and adds a prompt hook that — when you describe feature or bug work — reminds the agent to author the spec under `specs/` (via spec-author) before reaching for a brainstorming or planning skill. It's on by default and fully removed by `specship uninstall`; pass `specship install --no-sdd` to skip it. The rule is a tiny ordering nudge, not a duplicate of the MCP tool instructions.
- **The dashboard now works offline.** When the SpecShip server is down or unreachable, the desktop UI loads from a local cache instead of the browser's "this site can't be reached" page, and keeps showing the last data it loaded — each surface marked with how old it is (e.g. "Offline · 4m ago"). The connection indicator switches from ● Live to ● Offline, and actions that need the server (Refresh, saving a spec) are disabled with an offline notice until it reconnects. Data reloads automatically and the indicator returns to ● Live once the server is back.
- **The desktop dashboard got a full visual refresh.** Every screen — Dashboard, Graph, Specs, Drift queue, Workflows, Runs, Sessions, Heatmap, Costs, Compare, Memory, Tips, Design system and Settings — was reworked to match the latest SpecShip design: a shared component kit (state pills, trend deltas, segmented controls, treemaps, sparklines), a graph canvas with minimap + zoom controls + an inspector panel, and a denser, more legible layout throughout. Dark and light themes both carry through.
- **The dashboard now shows trends, not just totals.** The Dashboard stat tiles gained sparklines and week-over-week deltas, the Costs page shows the week-over-week change in spend, Compare breaks each project's cost down per model and lists its top tools, the Heatmap shows a 7-day call trend per file, and the Graph overview shows spec-link health, edge-type counts and the most-connected symbols. New `GET /api/claude/stats` and `GET /api/graph/health` endpoints back these, and the per-prompt duration is now available on Session Detail.
- **The Sessions list sorts newest-first.** Sessions now default to sorting by most-recent activity (Cost and Prompts remain as alternates) and the redundant project filter was removed, since the project picker already scopes the list.
- **Session Detail now surfaces what each session actually did, not just how much it cost.** A new "Session summary" panel sits between the stat strip and the prompt list, rolling up the top tools used (with call counts color-coded by kind), every slash command and skill the agent invoked across the session, the models that ran (multi-model sessions are now visible — sidechains to Haiku no longer hide behind the session-level last-model column), and the top files touched with their last operation. Every prompt row in the list also gains a slash-command pill when one was used (e.g. `/ss-spec`), an end-to-end duration (millisecond-aware so a 400 ms tool round-trip doesn't collapse to "0s"), and an inline chip strip of the tool mix for that turn (`Bash×3 Read×2 Edit×1`) so you can scan 700+ prompts and see which ones were heavy code work vs heavy thinking. Expanding a prompt now also lists every unique file it touched. Backed by a new lightweight `GET /api/claude/session/:id/summary` endpoint that does the aggregation in SQL alongside the existing detail endpoint.
- **Sessions → Session Detail now captures the assistant's reply, extended thinking, and full tool inputs — and pushes new prompts live.** The transcript ingestor used to parse each assistant turn's content blocks just to extract `tool_use` shells and then throw away the text/thinking blocks and the verbatim tool input JSON, so the dashboard could show "what the user asked + which tools fired + how many tokens" but not "what Claude actually said." Three new nullable columns (`claude_prompts.assistant_text`, `claude_prompts.thinking_text`, `claude_tool_calls.input_json`, schema migration v7) now persist that content as it's ingested. The Session Detail page renders the assistant response as full markdown (code blocks, tables, lists — same renderer the Memory and Specs pages use), shows extended thinking inside a collapsed-by-default `<details>`, and adds a click-to-expand chevron on every tool row that reveals the prettified raw input JSON beneath the existing one-line summary. A new SSE endpoint `GET /api/claude/session/:id/events` streams `prompt_added` / `tool_call_added` notifications every 500 ms (with a 15 s keepalive heartbeat); the page's new "● Live" pill turns green when SSE is connected, amber "● Polling" when the stream drops and falls back to a 5 s visibility-gated poll, and grey "● Idle" when the tab is hidden — so the prompt you just sent in Claude Code shows up on the dashboard within ~1 s without any clicking.
- **Memory page layout no longer collapses on tall rail content.** The Sources view used `.split.row` for its rail + detail column shell, which inherited `align-items: center` from the global `.row` utility — when the rail's file list grew tall, the whole split was vertically centered inside the available space and bled into the stat-strip / banners / filter-bar above it (reported via screenshot showing stat cards overlapping rail items). Switched the Memory page's containers to explicit display + direction + alignment, removed reliance on the global `.row` / `.col` utilities for the load-bearing layout boxes (memory-page, stat-strip, filter-bar, state-banner, split, rail, detail, rail-scroll, detail-scroll, eff-scroll), added `flex-shrink: 0` to the header-band siblings of `.split` so they keep their natural heights, and added `overflow: hidden` to `.rail` + `overflow-y: auto` to the scroll regions so content never escapes its container. Future global-utility refactors can't regress the layout the same way.
- **Sessions page: project-scoped, auto-refreshing, click-to-detail.** The Sessions list used to be locked to the boot-time primary project (so users running Claude Code against multiple projects saw the wrong sessions and called it stale) — it now passes the active-project slug to the API, refetches every 10 s while the tab is visible (paused via the Page Visibility API when you switch tabs), refetches immediately when you tab back, and has its own Refresh button that triggers the global sync+ingest. Each row now navigates to a new **Session Detail** page (`/sessions/:id`) that unrolls every prompt — user text, token breakdown (input / output / cache write / cache read), per-prompt cost, and every tool call with its name color-coded by kind (Read/Edit/Bash/MCP) plus the result size. Prompts are individually expandable with Expand-all / Collapse-all controls; subagent (sidechain) prompts are tagged so you can see at a glance which work the main agent delegated.
- **The dashboard's refresh button now actually refreshes everything.** Clicking the `↻` in the status strip now hits a new `POST /api/refresh` endpoint that force-syncs the SpecShip index AND triggers an immediate Claude Code transcript re-ingest, then broadcasts a global tick that every `apiResource` on the page listens to — Sessions, Heatmap, Costs, Memory, Drift, Graph, Specs all refetch in lockstep. Previously the button only refetched the status strip's own row; the data tabs stayed on whatever they'd cached. The button spins while the request is in flight, and partial failures (e.g. sync OK but ingest failed) surface as a small warning glyph with the error in its tooltip.
- **New `/ss-design-implement` slash command + bundled `claude-design-implement` workflow.** Takes a Claude Design URL (e.g. `https://claude.ai/design/p/<id>/?file=<File>.html`), snapshots the design source byte-for-byte into `specs/<slug>/snapshot.html` as a zero-loss reference, records the import audit trail at `specs/<slug>/source.md`, extracts design tokens to `specs/<slug>/tokens.css` mapped onto the project's existing token system, drafts a SpecShip spec covering contract / accessibility / responsive / interaction states (no pixel values — those stay in the snapshot + tokens), pauses at an approval gate for gap-fill questions, writes the spec, and hands off to `/ss-implement`. Designed so iterating on the design re-runs the same workflow and surfaces visual vs contract changes separately via `git diff`. Works with any handoff URL the agent can fetch — Claude Design connectors, Figma handoffs, or direct HTML.
- **Claude Design is now built into SpecShip — the standalone `designer` MCP is merged in.** `specship serve --mcp` exposes six new tools — `designer_session`, `designer_prompt`, `designer_ask`, `designer_list`, `designer_snapshot`, `designer_handoff` (surfaced as `mcp__specship__designer_*`) — that drive [claude.ai/design](https://claude.ai/design) over a debug Chrome via `agent-browser`. The driver is vendored from [`@pro-vi/designer`](https://github.com/pro-vi/designer) (MIT) into `src/designer/`, compiled separately to CommonJS and loaded through a lazy runtime boundary so neither `specship install` nor MCP startup ever touches Chrome — `agent-browser` / Chrome only launch when you actually invoke a designer tool. macOS only; needs `agent-browser` on PATH and a one-time Chrome debug-profile login (`designer setup`).
- **New `/ss-design-loop` slash command — the full design→code loop in one pipeline.** Drives the human-tasted design loop (Gate 1: iterate variants on claude.ai/design until "that's it"), runs `designer_handoff`, then feeds the resulting bundle to the `claude-design-implement` workflow (Gate 2: spec gap-fill review) and hands off to `/ss-implement`. To support it, `claude-design-implement` gained a `HANDOFF_DIR` (+ optional `CHOSEN_FILE`) input that specs a design bundle straight off disk — no re-fetch, no CDP from the headless workflow — folding the verbatim `decision-record.md` into `source.md` for provenance. The original URL path (`/ss-design-implement <url>`) is unchanged and now prefers the built-in `designer_snapshot` for the fetch.
- **Offline-install script is now safe on air-gapped boxes without a C toolchain.** `scripts/offline-install.sh` now passes `--ignore-scripts` to `npm ci`/`npm install` so the better-sqlite3 native-module rebuild can't fail the install, and skips `npm run build` when run against a pre-compiled drop (no `tsconfig.json` on disk).
- **Dashboard workflow routes now resolve in bundled mode without `@selvakumaresra/specship` on the module graph.** `packages/server/src/routes/workflow.ts` mirrors the loader pattern from `server.ts` — tries a relative-path import first, falls back to the named-package import in workspace/dev mode. Fixes "Cannot find package '@selvakumaresra/specship'" when running `specship serve --ui` from a different project directory after an offline install.
- **`.specship/workflows/` is now explicitly carved out of the auto-generated `.gitignore`.** Team-shared workflow definitions get committed by default; transient per-machine files (the database, daemon PID, sockets, logs) stay ignored as before.
- **Dashboard Memory tab is readable on real CLAUDE.md files.** The page now renders the markdown your CLAUDE.md actually uses — `###` subheads, numbered acceptance criteria, fenced code blocks with horizontal scroll, and full markdown tables for things like compatibility matrices — instead of falling through to flat paragraph text. The body card fills the detail panel width on wide desktops, loading state shows a skeleton rail instead of jumping straight to seed data, errors and "no project selected" surface as clear banners, and rail rows are real `<button>`s with keyboard navigation and ARIA labels.

- **Specs are now first-class peers of code.** Write requirements in Markdown under `specs/` with embedded IDs (`<!-- id: REQ-AUTH-005 -->`), and SpecShip indexes them alongside the code. Each spec is a queryable node with parent/child structure and a content-hashed body for drift detection. `specship index` (and the auto-sync hook) picks up the `specs/` directory automatically.
- **Spec→code links with state tracking.** A new join layer carries `implements` / `tests` / `documents` links between specs and code symbols, keyed on logical identity (file + qualified name) so the link survives line shifts and ordinary refactors. Links carry state — `implemented`, `verified`, `drifted`, `broken`, `orphaned` — and a drift axis (`spec` or `code`) so you can see whether the requirement or the implementation moved.
- **`specship_spec`, `specship_link_assert`, `specship_link_verify`, `specship_drifted` MCP tools.** The agent can fetch a spec (with its current linked code), declare a link after editing, mark verification pass/fail, and pull the drift queue. The `specship_node` response now also surfaces every spec linked to a symbol, so the agent picks up the spec layer through a tool it's already calling.
- **`specship drifted` CLI.** Lists drifted / broken / orphaned links from the terminal. Add `--fail-on=broken,drifted,orphaned` to make it a CI gate — useful in pre-commit / CI to refuse a PR that breaks a spec link.
- **Workflow engine.** Define YAML workflows (`.specship/workflows/*.yaml`) as DAGs of `prompt` / `bash` / `script` / `approval` / `cancel` nodes. The executor drives the agent through deterministic spec→implement→verify→link loops, with per-node tool restriction, retry, `depends_on` / `when:` conditionals, and `$nodeId.output` substitution. Workflow runs use git worktree isolation so the agent's changes don't touch your working tree.
- **Bundled spec workflows.** Four come with `specship install`: `spec-implement` (full implementation flow with approval gates), `spec-fix` (diagnose + repair a drifted link), `spec-verify` (run tests and promote `implemented` links to `verified`), `spec-relink` (re-attach an orphaned link after a refactor). Override by name with a YAML in `<project>/.specship/workflows/`.
- **New slash commands.** `/ss-spec`, `/ss-implement`, `/ss-drifted`, `/ss-fix`, `/ss-relink` are installed into Claude Code so you can drive the spec workflow from the prompt without remembering CLI syntax.
- **Workflow runtime surface.** `specship workflow run|resume|cancel|approve|reject|runs|list` for direct control; approval gates pause the workflow and persist state to `.specship/specship.db`, so a paused run survives Claude Code restarts.
- **Code-comment backstop.** Drop `// @implements REQ-AUTH-005` in a function's docstring and the next index picks it up as a spec link automatically. Doesn't replace `specship_link_assert` from the agent, but it catches what the agent forgets.

### Fixes

- **Workflow optional inputs now honor their declared `default`.** `specship workflow run` left a declared-but-omitted optional input undefined, so any `$INPUT.X` reference to it threw `OutputRefError` mid-run (e.g. `claude-design-implement`'s `OWNER` / `PRIORITY`). Declared inputs now resolve to their schema `default` (or `""`) before the run starts, so the documented `default` field finally takes effect.
- **`claude-design-implement` now writes the drafted spec, not the reviewer's comment.** The `write_spec` node referenced `$gap_review.output` — the approval-gate comment — as the spec body, which discarded the actual draft on approve. It now writes `$draft_spec.output` and folds the reviewer's gap-fill answers into it.
- **Non-code-graph tools survive the tiny-repo tool-gate.** On projects under the 500-file threshold SpecShip trims its MCP surface to the core code-graph tools; the merged `designer_*` tools are now exempt (they aren't code-graph tools) so they stay available regardless of project size.
- **Heatmap tiles are readable again.** The file treemaps on the Dashboard and the Heatmap page now use short, distinguishing file labels (instead of long absolute paths that all truncated to the same prefix) and render as clean tiles instead of thin slivers when a project has many lightly-touched files. The Heatmap page also picks up the design's larger, click-to-drill tile treatment.
- **Session Detail prompt list no longer disappears when the summary panel is present.** `.prompts` was sized to content (no `flex: 1`) in a flex column under `.page`. That worked while the only things above the list were the small page header, stat strip, and filter bar — the natural-height list stayed visible. When the new Session-summary panel landed (up to four cards stacking ~200–400 px), the total above-fold content pushed past the viewport and the list collapsed off-screen, leaving the user looking at the summary panel and the filter-bar header with no prompts beneath. `.prompts` now claims the remaining flex space with `flex: 1 1 0` and scrolls internally, and `.session-summary` is pinned with `flex-shrink: 0` so even very large summaries can't squeeze the list back out of the viewport.
- **Sessions list now shows accurate prompt counts (was inflated 10–20×).** Claude Code's JSONL transcripts emit one `type: 'user'` entry for the original prompt and another for *every* tool_result reply — all sharing the same `promptId`. The ingestor was running its INSERT-or-update path on every one of them, which (a) bumped `claude_sessions.prompt_count` once per entry, so a 50-prompt session landed in the dashboard as "844 prompts," and (b) the `ON CONFLICT DO UPDATE` clause reset the per-prompt token columns back to 0, losing accumulated counts from earlier assistant turns in the same prompt chain. The list said "836" while clicking through showed only 54 prompt cards — that mismatch was the bug. Ingestor now detects follow-up tool_result entries (the promptId already exists in this batch or in the DB) and skips the upsert and the aggregate bump for them; migration v8 backfills `prompt_count` for existing sessions in a single re-runnable `UPDATE … SET prompt_count = (SELECT COUNT(*) …)` so the dashboard shows correct numbers immediately on the next `serve` start without anyone having to re-ingest JSONLs from scratch.
- **Sessions page now actually filters to the picked project (instead of always showing zero).** The Sessions list — and any other dashboard surface that calls `projectQuery()` — sends the directory slug Claude Code uses for its transcript dir (e.g. `-Users-foo-projects-bar`) as the `?project=` filter, but the ingestor stores the *decoded* path (`/Users/foo/projects/bar`) on every session row. The server was doing an exact-equality compare between the two, so the list always came back empty even when the picker badge said "35 sessions exist." Sessions for the currently-active project — including the one you're recording right now — were never visible. The server now decodes the slug form before comparing, so the slug → path round-trip stays inside the dashboard and the list reflects what's in the DB. Paths passed directly (curl, scripts) keep working unchanged.
- **Claude Code transcripts no longer stall on resume.** When the ingest watcher reopened a JSONL mid-conversation, the first lines past the saved offset were assistant turns whose `promptId` is set by the original user entry — but that entry was in the previous batch, so the ingestor fell back to using the assistant message's per-message uuid as a stand-in. That uuid isn't a real `claude_prompts.id`, so when a follow-up `tool_result` matched a queued `tool_use`, the `claude_tool_calls` insert violated the prompt-id foreign key and rolled back the entire batch transaction — the file's offset never advanced and the same lines failed forever on every refresh. The ingestor now recovers the active prompt from the most-recent prompt in the session table when resuming, and no longer fabricates a fake prompt id, so the six transcripts that had been silently stuck for days (including the in-progress session whose dashboard view was the whole point) catch up cleanly on the next refresh.
- **`specship index` no longer crashes with `no such module: fts5` on Node 20/22/23.** SpecShip's schema uses SQLite FTS5 virtual tables for symbol search, but Node's built-in `node:sqlite` only ships FTS5 on Node 24+. `better-sqlite3` (which ships its own SQLite with FTS5) is now an optional dependency, so a default `npx @selvakumaresra/specship install` works on every Node version inside `engines.node`. If your install skips optional dependencies (`--omit=optional` or `npm_config_omit=optional`), Node 24+ is still required.

## [0.1.0] - 2026-06-06

First publication of the Claude Code–only fork to npm as `@selvakumaresra/specship`.

### Breaking Changes

- This fork is **Claude Code only**. The multi-agent installer (Cursor, Codex CLI, opencode, Hermes Agent, Gemini CLI, Antigravity IDE, Kiro) and all of its plumbing — auto-detection, multi-select prompts, per-agent target files, TOML/JSONC writers — have been removed. `specship install` now just configures Claude Code. The `--target` and `--print-config` flags are kept in vestigial form for backwards compatibility (only `claude` / `auto` / `all` / `none` are accepted) but no longer do anything meaningful. If you need other agents, use upstream [`@selvakumaresra/specship`](https://www.npmjs.com/package/@selvakumaresra/specship) instead.
- Published under a new npm name: `@selvakumaresra/specship` (was `@selvakumaresra/specship`). Existing global installs from the upstream package keep working — uninstall first (`npm uninstall -g @selvakumaresra/specship`) before installing this fork to avoid two `specship` binaries on PATH.

### New Features

- **Auto-sync hooks for Claude Code.** `specship install` now writes a `PostToolUse` hook on `Edit|Write|MultiEdit` and a `SessionStart` hook for `startup|resume` into your `settings.json`. The hooks run `specship sync --quiet` (async after edits, synchronous on session start) so the index keeps up with the agent's own edits without waiting on the background watcher. Gated on the same auto-allow opt-in as the permissions list — turn off with `--no-permissions`.
- **Slash commands.** `/cg-sync`, `/cg-trace <from> <to>`, `/cg-explore <symbol-bag>`, and `/cg-impact <symbol>` are installed into Claude Code's commands directory so you can drive SpecShip deterministically without waiting for the agent to choose a tool. Each command's body steers Claude away from Read / Grep fallback when the answer is in the graph.
- **`specship-explorer` subagent.** A restricted-tool subagent is installed under Claude Code's agents directory, with access to ONLY the specship MCP tools (no Read, Grep, Glob, Edit). Use the main agent's `Agent` tool to dispatch flow / impact / structural questions to it — its environment forces a Read-free workflow, which is the most reliable way to keep the agent from falling back to grep on questions the index can answer.
- **Ships as a Claude Code plugin too.** The repo root now contains a `.claude-plugin/plugin.json` manifest plus the `commands/`, `agents/`, and `hooks/` directories Claude Code looks for. Installing via `claude plugin install` wires everything up in one shot — no separate `specship install` step needed.
- Install SpecShip from a local source folder onto offline workstations with `scripts/offline-install.sh` (macOS / Linux) or `scripts/offline-install.ps1` (Windows) — uses your existing npm registry, with no GitHub access required.
- `specship status --json` now also reports the running CLI `version`, the index directory (`indexPath`), and a `lastIndexed` timestamp (ISO-8601, or null when nothing's indexed yet), so CI and scripts can pin the CLI version and check index freshness from a single command. A matching `SpecShip.getLastIndexedAt()` library method exposes the same freshness check without shelling out. Thanks @12122J and @eddieran. (#329)

### Fixes

- `specship sync` no longer fails with `duplicate column name: file_path` when the project's index was left half-initialized by an earlier crashed `specship init` (for example, on a Node build whose bundled SQLite lacks FTS5, where init died midway through creating the schema). Two safety nets land together: `init` now applies the schema atomically and removes the file on failure so the orphan state can't be created in the first place, and the migration step is now defensive so any indexes already in this state on disk will open and self-heal on first use instead of erroring on every command. If you hit this, simply re-run `specship sync` — no need to `rm -rf .specship/` manually anymore.
- The background file watcher no longer exhausts your machine's file-descriptor budget. On macOS it previously kept **one open file handle per watched file**, so on a large project the running MCP server could pile up tens of thousands of handles and blow past the system-wide limit — at which point *unrelated* apps (your shell, editor, Docker, browser) started failing with "too many open files" until the specship process was killed. The watcher now uses a single recursive watch on macOS and Windows, and bounded per-directory watches on Linux, so its cost stays flat no matter how large the project is. (#644, #496, #555, #628, #579)
- Indexing a project with very symbol-dense files (tens of thousands of functions or methods in a single file) no longer runs out of memory. The step that links dynamic call relationships used to load every function and method into memory at once, which could exhaust the heap and abort indexing with "JavaScript heap out of memory" on large or generated codebases; it now streams them, so memory stays flat no matter how many symbols the project has. (#610)
- Indexing a very large repository no longer aborts during its first sync with a "too many SQL variables" error. (#540)
- Files under directories with non-ASCII names (for example CJK characters) are no longer silently skipped during indexing. (#541)
- The `.specship/` index folder no longer clutters `git status`: its generated ignore file now excludes everything in the folder except itself, so the database, `daemon.pid`, sockets, and logs stop showing up as untracked changes. (#492, #484)
- SAP HANA `.xsjs` / `.xsjslib` files are now indexed as JavaScript. (#556)
- TypeScript `.mts` and `.cts` module files are now indexed instead of being skipped. (#366)
- JavaScript modules that wrap their code in an anonymous function — AMD/RequireJS, NetSuite SuiteScript, IIFE bundles — now have their inner functions and calls indexed, instead of the file coming up nearly empty. (#528)
- Go methods declared on generic types (e.g. `func (s *Stack[T]) Push(...)`) are now correctly attached to their type, so callers, callees, and impact include them. (#583)
- Asking what a symbol impacts no longer drags in every unrelated sibling method of its class — impact now follows real dependencies instead of the structural "contains" relationship, keeping the result focused on what actually depends on the symbol. (#536)
- SpecShip's MCP server now answers an agent's `resources/list` and `prompts/list` probes with an empty list instead of an error, clearing the `-32601` messages some clients (opencode, Codex) logged on connect. (#621)
- Svelte and Vue components used through a barrel file — `export { default as Button } from './Button.svelte'` re-exported from an `index.ts` and imported elsewhere — are no longer falsely reported as having **0 callers**. SpecShip now follows the default re-export all the way to the component and resolves the imports that `.svelte` / `.vue` files themselves use, so `specship_callers` and `specship_impact` see every place a component is used. This also covers components imported from another package in a workspace/monorepo (`@scope/ui/widgets`) and bare directory imports (`import { x } from './'`). Previously a live component consumed only through a barrel looked like dead code. Thanks @nakisen. (#629)
- Components used in a Vue Single-File Component's `<template>` — `<MyButton />`, or the kebab-case `<my-button />` — are now indexed as usages, so `specship_callers` and `specship_impact` include components that appear only in another component's markup (including through a barrel re-export). Previously only a Vue component's `<script>` block was analyzed, so template-only usages were invisible. (#629)

## [0.9.9] - 2026-06-02

### New Features

- `specship_explore` is now the primary tool, and one call is usually all an agent needs: it returns the verbatim source of the symbols relevant to your question (a plain question works as the query — you no longer need exact symbol names), grouped by file and Read-equivalent, so the agent answers without falling back to read/grep. The narrower `specship_context` and `specship_trace` tools were removed in favor of it — explore already surfaces the call flow among the symbols you name (the job trace did), so there's one obvious tool to reach for instead of three.
- `specship_explore` now includes a compact "Blast radius" for the symbols you're looking at — who depends on each (just the locations, not their source) and which test files cover it — so before editing, the agent can see what else to update and which tests to run, without a separate impact lookup. Symbols nothing depends on are skipped, so it stays short.
- Functions defined inside a store or handler object — the actions in a Zustand `create((set, get) => ({ … }))` store, and the same shape in Redux, Pinia, MobX, or any exported handler/route map — are now indexed as real symbols. Previously they existed only as object properties, so looking one up by name or asking who calls it returned "not found" and the agent had to read the whole store file to follow the flow; now `specship_node`, `specship_callers`, and `specship_explore` resolve them directly — including calls made through `useStore.getState().fetchUser()` or a destructured `const { fetchUser } = useStore.getState()`.
- `specship_explore` now surfaces the *right* definition when a method name is overloaded across types. Asking about, say, `DataRequest`'s `task` and `validate` used to return a same-named method from an unrelated file (or an abstract base stub) and bury the one you meant; explore now recognizes the type you named in the query and leads with that type's own overloads, in full.

### Fixes

- Search ranking no longer lets a common word in your request hijack the results: asking about, say, a "flat object" screen used to surface an unrelated constant that merely happened to be named the same, because the exact-name match outweighed everything else. Ranking now weighs how well each result is corroborated by the rest of your request, so the symbols you actually meant come first (this improves `specship_explore`'s results).
- `specship_node` now returns *every* definition when a name is ambiguous — an overloaded method, or the same method name on different types — instead of returning one (sometimes the wrong one) with a note listing the rest. Asking for such a symbol now hands back all of the matching definitions with their source in a single call, so the agent stops having to read the file by hand to find the specific overload it wanted (common in Swift, Go, Java, and C#). For a heavily-overloaded name (a `poll`/`validate` with dozens of definitions), pass `file` (and/or `line`) — e.g. the `file:line` shown in a trail — to get that exact definition's body. Large overload sets show the most relevant ones in full and list the remainder by location.
- `specship_explore` never returns half a method anymore: when output runs up against its size budget it drops whole methods or whole files (and lists what it dropped, so you can ask for them in another call) instead of cutting off a method body partway. A truncated method was the one case that still sent the agent to read the file for the rest — so the source explore returns is now always complete and usable as-is.

## [0.9.8] - 2026-06-01

### New Features

- `specship init` now builds the initial index by default — you no longer need the `-i`/`--index` flag (it's still accepted, so existing commands and scripts keep working). (#483)
- Go: Gin middleware chains now connect end-to-end in `specship_trace` and `specship_explore` — following a request reaches the middleware and route handlers registered via `.Use()` / `.GET()` instead of dead-ending where the framework dispatches the chain dynamically.
- `specship_explore` now sizes its response to the *answer* instead of the file count: it shows the mechanism and the exact methods you asked about in full — even when they're buried deep in a large file — while collapsing the redundant interchangeable implementations of an interface (an HTTP interceptor chain, a query-compiler family) down to signatures. Fewer tokens for a more complete answer, so on the flows that used to occasionally cost more than plain grep/read it's now clearly cheaper — and the win holds across small, medium, and large codebases. Distinct, non-interchangeable code is shown in full as before. Disable with `SPECSHIP_ADAPTIVE_EXPLORE=0`.
- Swift deferred-validation flows (and similar "handler array" patterns) now connect end-to-end in `specship_trace` and `specship_explore` — following a request's lifecycle reaches the validators registered with `.validate { … }` instead of dead-ending where the framework runs them by iterating a stored list of closures. Any pattern where closures are appended to a collection and later invoked by looping over it is now traced.
- `specship_explore` now spells out the dynamic-dispatch relationships of the symbols you ask about — e.g. "the closures registered here are run by `didCompleteTask`" — so the indirect hops you'd otherwise grep to reconstruct are listed alongside the call flow.
- `specship_explore` answers multi-phase questions that span a large "god file" far more completely. For a flow like "build, send, and validate a request" — where one big file holds the build chain and the validate logic lives in others — it now keeps every method *on the flow path* in full, collapses the file's off-path methods to one-line signatures, and guarantees each phase's defining file is shown (instead of truncating at a fixed size and dropping whichever phase came last, which sent you to read it by hand). Incidental files that merely name-drop the flow are still trimmed, so the response stays focused on the code that answers the question.
- SpecShip is usable as an embedded library again: `require("@selvakumaresra/specship")` and `import` now resolve the programmatic API — the `SpecShip` class plus building blocks like `DatabaseConnection`, `QueryBuilder`, `initGrammars`, and `FileLock` — so you can drive the graph directly from your own app (for example an Electron process) instead of only through the CLI or MCP server. Embedding runs on your own runtime, so it needs Node 22.5+ for the built-in SQLite. (#354)

### Fixes

- `specship_trace` now resolves an overloaded symbol name to its real implementation instead of an empty protocol/delegate stub. Tracing a flow through a heavily-overloaded API (common in Swift, Java, C#, and Go) could land on an unrelated no-op method that happened to share the name and report "no path"; it now picks the substantive definition the flow actually runs through.
- SpecShip's MCP server now answers an agent's opening handshake the instant it launches instead of blocking while the index loads, so a fresh session's very first tool call no longer occasionally races a server that's still warming up and falls back to grep/read. The first question in a new session now reliably goes through SpecShip.
- Indexing a project that contains only config-style files (YAML, Twig, or `.properties`) no longer misleadingly reports "No files found to index" — these files are tracked at the file level and are now counted as indexed. Thanks @luojiyin1987 (#357).

## [0.9.7] - 2026-05-28

### New Features

- Go: gRPC interface stubs now connect to their hand-written implementation, so callers, callees, impact, and trace land on the real method instead of an empty generated stub.
- Generated files (protobuf, gRPC stubs, mocks, build output) now rank last in search, trace, and explore, so results land on your real implementation instead of an auto-generated placeholder.
- When `specship_trace` can't find a static path (a dynamic-dispatch break), it now inlines both endpoints' source, callers, and callees in one response, so the agent gets the full picture without a flurry of follow-up calls.
- Trace now picks the right endpoints in large multi-module repos by preferring symbols that share a directory, instead of grabbing an arbitrary same-named symbol from an unrelated module.
- Test files are now deprioritized in `specship_explore` (Go, Ruby, JS/TS, Java/Kotlin/Scala), so the explore budget goes to your real implementation source.
- Small projects (under ~500 files) now resolve flow questions in fewer MCP calls, with a leaner tool surface and tuned context and explore output sized for the project.
- `specship_context` now auto-traces flow questions like "how does X reach Y" or "trace the path from A to B", splicing the trace into the response so you don't need a separate `specship_trace` call.
- `specship_context` now inlines a URL-to-handler routing table and the source of your main routes file for routing questions on small projects, so you don't have to go read `routes.rb` or `web.php` yourself.
- `specship_context` search now boosts results in the directory of a project's core framework file, so a small same-named extension file no longer outranks the actual framework core.
- Interface-to-implementation linking now works for C#, TypeScript, JavaScript, Swift, and Scala (previously Java/Kotlin only), so investigating an interface method surfaces its concrete implementations.
- MCP tool descriptions are now shorter, trimming per-session overhead while keeping the steering guidance.
- Java and Kotlin imports now resolve by fully-qualified name, so same-name classes in different packages are told apart correctly in multi-module Spring and Android codebases, including across the Java/Kotlin interop boundary.
- Java and C# anonymous classes (`new T() { ... }`) and their overridden methods are now indexed as real class nodes, so an agent sees those hidden overrides in its trail without a Read.
- The installer no longer writes a duplicate `## SpecShip` instructions block into your agent's instructions file (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, Cursor's `.cursor/rules/specship.mdc`, or Kiro's steering doc) — the MCP server is now the single source of truth, and re-running `specship install` or `specship uninstall` strips a block a previous version left behind (#529). If you added your own notes inside the `SPECSHIP_START`/`SPECSHIP_END` markers, move them outside the markers first, since the whole marked block is removed.

### Fixes

- MCP tools no longer return results for files that were deleted while no server was running — the first query of a session now waits for the catch-up sync, so you get the correct index instead of stale rows.
- Windows: black console windows no longer flash on every file save or MCP reconnect (#485, #510, #530).
- `specship index` and `init -i` now report the true edge count in their summary, instead of undercounting by missing resolution and synthesizer edges.

## [0.9.6] - 2026-05-27

### New Features

- Enterprise Spring and MyBatis flows now trace end-to-end: MyBatis XML mappers are indexed and linked to their Java mapper interfaces, Spring `@Value` and `@ConfigurationProperties` references resolve to the matching keys in your `application.yml`/`.properties` config (including relaxed kebab/camel/snake binding), and field-injected concrete beans like `this.field.method()` resolve through to their implementation (#389).
- Gemini CLI (and the rebranded Antigravity CLI) plus the Antigravity IDE are now supported by `specship install`, detected and configured out of the box with sibling settings and MCP servers preserved across re-installs (#399).
- Kiro (CLI and IDE) is now supported by `specship install` on macOS, Linux, and Windows, with its own steering file so it loads SpecShip guidance naturally (#385).

### Fixes

- C/C++: bare `#include "header.h"` directives now connect to the real header file instead of a phantom import, so includes show up as true file-to-file edges; system and stdlib headers are filtered out so they don't false-resolve (#453).
- Java/Kotlin: imports now disambiguate same-name classes across modules using the fully-qualified import path, so callers, callees, and trace land on the right class in multi-module projects instead of guessing by file proximity (#314).
- TypeScript: `type` aliases with object shapes (including function-typed members and intersection types) now surface their members in the graph, so a call like `handle.stop()` resolves to the alias member instead of an unrelated look-alike class in a sibling directory (#359).
- C#: parameter, return, property, and field types now produce reference edges, so callers and callees on a DTO or service type return real results instead of nothing (#381).
- Go: cross-package qualified calls like `pkg.Func()` now resolve to the right package by reading your `go.mod`, so callers, callees, impact, and trace return complete results on Go monorepos instead of almost nothing (#388).
- `specship_files` now returns the whole project when an agent passes a root-ish path like `/`, `.`, `./`, `""`, or a Windows-style `\`, and subdirectory filters like `/src`, `./src`, and `src\components` all resolve correctly instead of returning "No files found" (#426).
- The file watcher no longer marks edited files as fresh when another process holds the index lock, so the per-file staleness signal stays accurate until the edit is actually indexed (#449).
- TypeScript/JavaScript: calls inside top-level variable initializers (`const token = getToken()`) and inside inline object-literal methods are no longer dropped, so they show up in callers as expected, including in Vue single-file components (#425).
- Watch sync no longer aborts with a `FOREIGN KEY constraint failed` error in a long-running daemon; a stale lookup now drops a single edge instead of failing the whole sync (#455).
- Hermes: `specship install --target hermes` no longer corrupts `~/.hermes/config.yaml`, correctly handling PyYAML's block-style lists and re-installing cleanly even on an already-corrupted file (#456).
- NestJS: route prefixes from `RouterModule.register([...])` (including nested `children`) now propagate to controller routes, so a route shows up at its full path like `GET /admin/users` instead of `GET /` (#459).
- C++: callers now resolve through typed member pointers such as `m_alg->Processing()`, including out-of-line method definitions and the common case of two classes sharing a method name (#445, #454).

## [0.9.5] - 2026-05-25

### New Features

- Running multiple AI agents in the same project no longer multiplies the cost: two Claude Code windows, a worktree agent, or parallel sub-agents now share one background daemon per project with a single file watcher, SQLite connection, and tree-sitter warm-up instead of N independent copies (#411).
- The daemon runs detached so it outlives any single session, meaning closing one editor or terminal never severs the others; it lingers briefly after the last client disconnects so back-to-back sessions skip the startup cost, then exits and cleans up after itself. Tune the idle wait with `SPECSHIP_DAEMON_IDLE_TIMEOUT_MS` (default five minutes).
- Set `SPECSHIP_NO_DAEMON=1` to opt out and get one independent server per client, handy for debugging or sandboxes that disallow local sockets; the daemon is also version-pinned, so upgrading SpecShip never mixes versions over the connection.
- SpecShip responses now tell the agent which files are pending re-index: when the watcher has seen edits since the last sync, tool responses add a warning banner naming the stale files and their state so the agent reads just those directly while trusting the rest, with zero cost when nothing is pending (#403).
- `SPECSHIP_WATCH_DEBOUNCE_MS` lets you tune the file-watcher quiet window (default 2000ms) for workspaces with bursty writes like format-on-save chains or large generated outputs, without touching your agent's command line (#403).
- Objective-C indexing: `.m`, `.mm`, and content-sniffed `.h` files now parse with full structural extraction, including full multi-part selectors, properties, imports, and superclass/protocol relationships, so trace, callers, and callees work across iOS codebases (#165).
- Mixed iOS, React Native, and Expo projects now trace end-to-end across language boundaries: Swift to Objective-C auto-bridging, the React Native legacy bridge and TurboModules, native-to-JS event channels, Expo Modules, and Fabric/Codegen view components are all bridged so flows connect through gaps that static parsing alone can't follow (#401).

### Fixes

- TypeScript: types used only in an interface's property or method signatures now produce references edges, so impact and callers on a type include every consumer that imports it just for an interface shape (#432).
- Git worktrees no longer silently borrow another tree's index; running SpecShip from a worktree nested inside the main checkout used to return the wrong branch's code with no warning, and now both the status command and every read tool call out the conflict and point you to `specship init -i` in the worktree (#155).
- The file watcher no longer exhausts the OS file-watch budget on large repos: it now excludes the same directories the indexer ignores (defaults plus your `.gitignore`) before registering watches, so SpecShip can run alongside your editor or dev server without hitting the per-user watch ceiling (#276).
- The index now stays in sync after `git pull`, branch switches, and edits made outside your editor; change detection is filesystem-based instead of relying on `git status`, so pulled or checked-out code is picked up without a full re-index.
- The MCP server now catches up on connect, reconciling anything that changed while it wasn't running so your first query reflects the current code instead of a stale snapshot.
- Dependency, build, and cache directories like `node_modules`, `vendor`, `dist`, `build`, `target`, `.venv`, `__pycache__`, `Pods`, and `.next` are now excluded by default, so context and search reflect your code instead of third-party noise even in a project with no `.gitignore`; add a `.gitignore` negation to index one anyway (#407).

## [0.9.4] - 2026-05-24

### New Features

- Request-to-handler flows now trace end-to-end across many web stacks, with new or improved route resolution for Express, Rails, Spring (Java and Kotlin), Django/DRF, Laravel, Flask, FastAPI, Gin, chi, ASP.NET, Drupal, Axum, actix, Vapor, Play, Vue/Nuxt, Svelte/SvelteKit, and React Router.
- `specship_trace`, `specship_callees`, and `specship_explore` now follow flows that have no static call edge — callback and observer registration, EventEmitter, React re-renders and JSX children, Flutter `setState` to `build`, C++ virtual overrides, and Java/Kotlin interface-to-implementation dispatch (like Spring's `@Autowired` service calls) — and each bridged hop is labeled inline in trace with where it was wired up.
- `specship_trace` now returns a self-contained flow dossier: every hop shows its full body inline plus the destination's own outgoing calls, so a single trace usually answers a "how does X reach Y" question without a follow-up explore, node, or Read.
- `specship_explore` now leads with the execution flow when your query names the symbols of a flow, finding the call path among those symbols (including across dynamic-dispatch hops) so you get a trace-quality answer without switching tools.
- `specship_node` and `specship_trace` now emit line-numbered source (matching `specship_explore` and Read), so you can cite or edit exact lines without re-reading the file just to recover line numbers.
- New `SPECSHIP_MCP_TOOLS` environment variable lets you expose only a chosen subset of specship tools over MCP (e.g. `trace,search,node,context`) without editing your client's MCP config; unset exposes all of them.
- Release archives now ship with a `SHA256SUMS` file, and the npm launcher verifies the bundle it downloads against it, aborting on a mismatch (releases published before this change skip verification rather than failing).

### Fixes

- Several static-extraction and resolution correctness fixes underpin the routing work above: C++ inheritance edges that were previously missing, Dart methods that were extracted signature-only, Python handlers named `index`/`get`/`update` that were being silently dropped, and an explore output-budget issue that under-returned source on repos with very large files.
- `specship serve --mcp` no longer keeps running after its parent agent is force-killed (OOM, `kill -9`, or container teardown) on Linux, where it used to hold inotify watches, file descriptors, and the SQLite WAL indefinitely; the server now shuts down as soon as its parent process changes, tunable via `SPECSHIP_PPID_POLL_MS` (#277).
- Installing `@selvakumaresra/specship` through a registry mirror that hadn't yet mirrored the matching per-platform package no longer fails with `no prebuilt bundle for <platform>`; the launcher now downloads the bundle from GitHub Releases and caches it, with `SPECSHIP_NO_DOWNLOAD=1` to disable the fallback and `SPECSHIP_DOWNLOAD_BASE` to point it at your own mirror (#303).
- `install.sh` no longer fails with `403` / "could not resolve latest version" on shared or cloud hosts that exhaust GitHub's unauthenticated API rate limit; it now resolves the version through the unthrottled releases redirect, and `SPECSHIP_VERSION` accepts a bare version like `0.9.4` as well as `v0.9.4` (#325).

## [0.9.3] - 2026-05-22

### New Features

- New `specship uninstall` command cleanly removes SpecShip from every agent it's configured on — Claude Code, Cursor, Codex CLI, opencode, and Hermes Agent — in one step, asking whether to clean up your global or this project's local config and reporting exactly which agents it touched; it accepts `--location`, `--target`, and `--yes` for scripted or non-interactive use, removes only what `specship install` wrote, and leaves your `.specship/` index alone (#313).

### Fixes

- Indexing a large multi-language project no longer aborts partway through with a `Fatal process out of memory: Zone` crash on Node.js 22 and 24, even with plenty of RAM free — SpecShip now launches with a V8 flag that keeps grammar compilation off the optimizing tier, and any launch path that doesn't get the flag directly re-execs once with it automatically (#298, #293). Node 25 stays blocked for now, since its variant of this bug isn't fixed by the same flag.
- Uninstalling from Cursor now deletes the leftover `.cursor/rules/specship.mdc` file outright instead of leaving an orphaned, empty rule behind, while keeping any content you added outside SpecShip's markers.

## [0.9.2] - 2026-05-21

### Breaking Changes

- SpecShip no longer has a config file: `.specship/config.json` and the entire config surface are gone, and the library API for it (the config type, the `config` option on `init()`, and the get/update config exports) has been removed — existing config files are now ignored, and `.gitignore` is the single source of truth for what gets indexed. The `.specshipignore` marker is also no longer supported; use `.gitignore` instead.

### New Features

- `specship install` now supports Hermes Agent (Nous Research), wiring up the SpecShip MCP server so Hermes can drive the knowledge graph like the other agents.
- Drupal projects (8/9/10/11) are now detected and indexed with framework smarts: routes from `*.routing.yml` link to their controller, form, or entity-handler, and hook implementations across modules are connected to their canonical hook name, so asking for callers of a hook returns every implementation (#268).
- Indexing is now zero-config and honors your `.gitignore` everywhere — in git repos via git, and in non-git projects by reading `.gitignore` files directly — so to keep something out of the graph you just add it to `.gitignore`. Behavior change: committed files that aren't gitignored are now indexed even under `vendor/`, `Pods/`, or a committed `dist/`; add a `.gitignore` negation to exclude them (#283).

### Fixes

- Windows: installing globally and then running any `specship` command no longer fails — the launcher now invokes the bundled runtime directly instead of a `.cmd` file that modern Node refuses to spawn, so `specship` works regardless of your Node version (#289).

### Security

- The temp-dir marker written on each `specship_context` call is now opened safely so it can't follow a symlink, closing a hole where another local user on a shared machine could redirect that write onto a file you can write (#280).

## [0.9.1] - 2026-05-21

### Fixes

- The standalone installers (`curl … | sh` and `irm … | iex`) no longer fail to launch on a machine that has no Node installed.
- Installing with `npm i -g` on Linux x64 now finds its bundle, after the 0.9.0 release silently shipped without the linux-x64 package; the release pipeline now verifies every package reached the npm registry so a release can't pass green-but-broken again.

## [0.9.0] - 2026-05-21

SpecShip now ships its own self-contained runtime, so it installs on any Node version — or none at all — with no native build step, and the old intermittent "database is locked" errors are gone for good.

### New Features

- One-line standalone installers that need no Node.js: `install.sh` on macOS and Linux, and `install.ps1` on Windows fetch the self-contained bundle and put `specship` on your PATH (you can still use `npm`/`npx` on any Node version too).
- SpecShip now uses real SQLite with full WAL and FTS5 built into its bundled runtime, which fixes the concurrent-read "database is locked" errors at the root, removes the native build step entirely, and runs faster for anyone who had been stuck on the old WASM fallback (#238).
- Lua: SpecShip now indexes `.lua` projects (Neovim plugins, Kong, OpenResty, game code), surfacing functions, table methods, local variables, `require(...)` imports, and the call edges between them.
- Luau: SpecShip now indexes `.luau`, Roblox's typed superset of Lua, adding type and `export type` aliases, typed function signatures, generics, and Roblox instance-path requires on top of everything Lua extracts (#232).
- `specship status` now reports the effective journal mode, so a "database is locked" report is easy to triage at a glance.

### Fixes

- Re-running `specship install` now strips the broken auto-sync hooks that pre-0.8 versions wrote into Claude Code's settings, which had been causing a "Stop hook error: unknown command 'sync-if-dirty'" on every turn. The cleanup is surgical and leaves unrelated hooks untouched. Re-run `specship install` once on an affected machine to clear the error.

## [0.8.0] - 2026-05-20

### Breaking Changes

- The minimum supported Node.js version is now 20 (Node 18 is end-of-life); Node 22 LTS and Node 24 get the fast native backend out of the box, other Node versions still run via the slower WASM fallback, and Node 25+ remains blocked (#81). If you're on an older Node, upgrade to 20 or newer.

### New Features

- NestJS: SpecShip now recognizes NestJS projects and surfaces the route that binds each handler across HTTP controllers, GraphQL resolvers, microservice handlers, and WebSocket gateways, detected automatically from any `@nestjs/*` dependency (#220).
- `specship_explore` source now includes line numbers, so an agent can cite `file:line` straight from the result instead of reopening the file to find a line number; set `SPECSHIP_EXPLORE_LINENUMS=0` to disable.
- On WSL2 `/mnt/*` drives, where the live file watcher is too slow and could break MCP startup, SpecShip now skips the watcher and offers to keep the index fresh with git hooks instead; new `SPECSHIP_NO_WATCH=1` (or `serve --mcp --no-watch`) forces the watcher off anywhere, and `SPECSHIP_FORCE_WATCH=1` overrides the WSL auto-detect when your setup is actually fast.
- SpecShip now guides agents to answer "how does X work" and architecture questions directly with a couple of specship calls instead of delegating to a file-reading sub-agent or a grep-and-read loop, which gives faster, cheaper, `file:line`-cited answers on medium and large repos.
- `specship_node` with code on a class, interface, struct, or enum now returns a compact member outline (fields plus method signatures with line numbers) instead of the entire class body; functions and methods still return their full source.
- `specship_explore` output now scales with project size, so small projects get tighter responses than your native grep-and-read flow would produce while large codebases keep their fuller budget, and a per-file cap stops a single dense file from collapsing into a whole-file dump (#185). Thanks @essopsp.
- Search ranking now correctly de-prioritizes CamelCase test files (`FooTest.kt`, `BarTests.swift`, `BazSpec.scala`, `QuxTestCase.cs`) and test source-set directories in Kotlin, Swift, Scala, and C#, so real implementations no longer get outranked by tests.

### Fixes

- `specship_explore` output is now hard-capped to its size budget, so an oversized response no longer overruns the cap and sits in the agent's context to be re-read every turn.
- Newly created untracked files are no longer reported as pending forever and re-indexed from scratch on every `specship sync`; SpecShip now hash-compares them against the index the same way it does tracked files (#206). Thanks @15290391025.
- `specship init -i` now finds source inside nested, independent git repositories that aren't submodules (common in CMake super-repo layouts), instead of reporting "No files found to index" (#193). Thanks @timxx.
- On Node 24, indexing no longer silently drops to the slower fallback backend with a warning that couldn't be cleared; a fresh install on Node 22 or 24 now gets the fast native backend with no compiler, and `specship status` should report it (#203). Thanks @Finndersen.
- MCP tools no longer fail with "SpecShip not initialized" when the index actually exists; when the client doesn't report a workspace root, the server now asks for it via the standard MCP `roots/list` request before falling back, and the error message is actionable when a project still can't be resolved (#196). Thanks @zhangyu1197.
- The MCP server no longer hangs on startup under WSL2 when the project lives on an NTFS `/mnt/*` mount, so the specship tools actually appear; SpecShip auto-skips the watcher there with manual and git-hook sync fallbacks (#199). Thanks @mengfanbo123.
- Claude Code project-local installs now write the MCP server to `.mcp.json` (the file Claude Code actually reads for project-scoped servers) instead of a file it ignores, and re-running `specship install` migrates an affected project automatically (#207). Thanks @Jhsmit.
- Source-omission markers in `specship_explore` and `specship_context` output are now language-neutral instead of C-style comments, so they no longer look wrong inside Python, Ruby, and other non-C source blocks.

## [0.7.10] - 2026-05-19

### Fixes

- SpecShip tools now reliably appear in your client on slow filesystems (Docker Desktop VirtioFS on macOS, WSL2), where the startup handshake could previously time out and leave the process running with no tools visible (#172). Thanks @sashanclrp and @sgrimm.
- On Windows PowerShell and cmd.exe, terminal output during `specship index` and `specship sync` no longer turns into garbled characters; SpecShip now uses plain ASCII glyphs by default on Windows, with `SPECSHIP_UNICODE=1` to opt back into the Unicode glyphs or `SPECSHIP_ASCII=1` to force ASCII on any platform (#168). Thanks @starkleek and @Bortlesboat.
- Module-qualified symbol lookups now resolve in the specship tools, so you can pass names like `module::symbol` (Rust, C++, Ruby), `Module.symbol` (TypeScript, JavaScript, Python), or `module/symbol`, including multi-level paths and Rust prefixes like `crate`, `super`, and `self` (#173). Thanks @joselhurtado.

## [0.7.9] - 2026-05-17

### New Features

- opencode: the installer now writes an `AGENTS.md` file with SpecShip usage guidance, so opencode reaches for the `specship_*` tools instead of falling back to its native search.
- opencode: your comments and formatting in `opencode.jsonc` now survive install, re-install, and uninstall, because the installer makes surgical edits instead of rewriting the whole file.

### Fixes

- opencode: `specship install` now wires up the MCP server in the file opencode actually reads — previously it wrote to a config file opencode ignores by default, so the SpecShip entry never appeared in any opencode session; re-run `specship install --target=opencode` after upgrading so the entry lands in the right place.

## [0.7.7] - 2026-05-17

### New Features

- `specship install` now sets up Claude Code, Cursor, Codex CLI, and opencode from one multi-select prompt, with any agents it detects pre-checked, so a single install wires up every editor you use (#137).
- You can install non-interactively for scripting and CI with flags like `--target`, `--location`, `--yes`, `--no-permissions`, and `--print-config`.
- `specship init` now auto-wires project-local agent config for any agent you installed globally, so one global `specship install` works in every project you open without re-installing per project.
- Agent instructions are now agent-agnostic and tell each agent to trust specship results instead of re-verifying with grep, fixing the case where Cursor and Codex fell back to native search even with specship available.
- The install prompts are clearer: the agent picker comes first, and the separate "install the CLI on your PATH" and "apply to all projects or just this one" questions no longer both read as "Global".

### Fixes

- Cursor: a globally-installed specship no longer reports "not initialized" in every workspace; the installer now passes the correct project path into Cursor's MCP config to work around Cursor launching MCP servers with the wrong working directory.

Thanks @andreinknv for the substantive draft this release was based on.

## [0.7.6] - 2026-05-13

### Fixes

- Fixed the `specship` command failing with `permission denied` right after a fresh global install — the 0.7.5 package shipped the CLI without its executable bit, so your shell refused to run it. New installs work out of the box. If you're stuck on 0.7.5, upgrade to 0.7.6 or unblock yourself in place by making the installed binary executable with `chmod +x`.

[0.9.7]: https://github.com/selvakumarEsra/specship/releases/tag/v0.9.7
[0.9.6]: https://github.com/selvakumarEsra/specship/releases/tag/v0.9.6
[0.9.5]: https://github.com/selvakumarEsra/specship/releases/tag/v0.9.5
[0.9.4]: https://github.com/selvakumarEsra/specship/releases/tag/v0.9.4
[0.9.3]: https://github.com/selvakumarEsra/specship/releases/tag/v0.9.3
[0.9.2]: https://github.com/selvakumarEsra/specship/releases/tag/v0.9.2
[0.9.1]: https://github.com/selvakumarEsra/specship/releases/tag/v0.9.1
[0.9.0]: https://github.com/selvakumarEsra/specship/releases/tag/v0.9.0
[0.8.0]: https://github.com/selvakumarEsra/specship/releases/tag/v0.8.0
[0.7.10]: https://github.com/selvakumarEsra/specship/releases/tag/v0.7.10
[0.7.9]: https://github.com/selvakumarEsra/specship/releases/tag/v0.7.9
[0.7.7]: https://github.com/selvakumarEsra/specship/releases/tag/v0.7.7
[0.7.6]: https://github.com/selvakumarEsra/specship/releases/tag/v0.7.6
[0.9.8]: https://github.com/selvakumarEsra/specship/releases/tag/v0.9.8
[0.9.9]: https://github.com/selvakumarEsra/specship/releases/tag/v0.9.9
[0.5.0]: https://github.com/selvakumarEsra/specship/releases/tag/v0.5.0
[0.6.0]: https://github.com/selvakumarEsra/specship/releases/tag/v0.6.0
[0.7.0]: https://github.com/selvakumarEsra/specship/releases/tag/v0.7.0
[0.10.0]: https://github.com/selvakumarEsra/specship/releases/tag/v0.10.0
[0.11.0]: https://github.com/selvakumarEsra/specship/releases/tag/v0.11.0
[0.11.1]: https://github.com/selvakumarEsra/specship/releases/tag/v0.11.1
[0.11.2]: https://github.com/selvakumarEsra/specship/releases/tag/v0.11.2
[0.11.3]: https://github.com/selvakumarEsra/specship/releases/tag/v0.11.3
[0.11.4]: https://github.com/selvakumarEsra/specship/releases/tag/v0.11.4
[0.11.5]: https://github.com/selvakumarEsra/specship/releases/tag/v0.11.5
[0.11.6]: https://github.com/selvakumarEsra/specship/releases/tag/v0.11.6
[0.11.7]: https://github.com/selvakumarEsra/specship/releases/tag/v0.11.7
